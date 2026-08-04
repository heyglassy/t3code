import { CommandId, type OrchestrationEvent, type ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";

import { forkParked } from "../../serverActivation.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { QueuedTurnReactor, type QueuedTurnReactorShape } from "../Services/QueuedTurnReactor.ts";

const isDispatchable = (status: string | undefined): boolean =>
  status === "idle" || status === "ready" || status === "interrupted";

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;

  const dispatchHead = Effect.fn("dispatchQueuedTurnHead")(function* (threadId: ThreadId) {
    const model = yield* snapshots.getCommandReadModel();
    const thread = model.threads.find((entry) => entry.id === threadId);
    if (!thread || !isDispatchable(thread.session?.status)) return;
    const head = (thread.queuedTurns ?? []).toSorted(
      (left, right) => left.queueSequence - right.queueSequence,
    )[0];
    if (!head || head.status !== "queued") return;
    yield* engine.dispatch({
      type: "thread.queued-turn.dispatch",
      commandId: CommandId.make(
        `queued-turn:${thread.id}:${head.messageId}:attempt:${head.attempt}`,
      ),
      threadId: thread.id,
      messageId: head.messageId,
      createdAt: yield* DateTime.now.pipe(Effect.map(DateTime.formatIso)),
    });
  });

  const processEvent = (event: OrchestrationEvent) => {
    if (event.aggregateKind !== "thread") return Effect.void;
    const threadId = event.aggregateId as ThreadId;
    if (
      event.type === "thread.turn-queued" ||
      event.type === "thread.queued-turn-retried" ||
      (event.type === "thread.session-set" && isDispatchable(event.payload.session.status))
    ) {
      return dispatchHead(threadId).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning("queued turn reactor failed to dispatch queue head", {
                threadId,
                cause: Cause.pretty(cause),
              }),
        ),
      );
    }
    return Effect.void;
  };

  const worker = yield* makeDrainableWorker(processEvent);
  const start: QueuedTurnReactorShape["start"] = Effect.fn("start")(function* () {
    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) => worker.enqueue(event)),
    );
    const model = yield* snapshots.getCommandReadModel().pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("queued turn reactor failed to recover persisted queue", {
          cause: Cause.pretty(cause),
        }).pipe(Effect.as(null)),
      ),
    );
    if (model === null) return;
    yield* Effect.forEach(
      model.threads.filter((thread) => isDispatchable(thread.session?.status)),
      (thread) => dispatchHead(thread.id).pipe(Effect.ignoreCause({ log: true })),
      { discard: true },
    );
  });

  return { start, drain: worker.drain } satisfies QueuedTurnReactorShape;
});

export const QueuedTurnReactorLive = Layer.effect(QueuedTurnReactor, make);
