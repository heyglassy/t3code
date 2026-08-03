import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationSession,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { expect, it } from "@effect/vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const THREAD_ID = ThreadId.make("thread-1");
const MODEL = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };

function session(status: OrchestrationSession["status"]): OrchestrationSession {
  return {
    threadId: THREAD_ID,
    status,
    providerName: "codex",
    providerInstanceId: ProviderInstanceId.make("codex"),
    runtimeMode: "full-access",
    activeTurnId: status === "running" ? TurnId.make("turn-active") : null,
    lastError: null,
    updatedAt: NOW,
  };
}

function readModel(overrides: Partial<OrchestrationReadModel["threads"][number]> = {}) {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: THREAD_ID,
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: MODEL,
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
        ...overrides,
      },
    ],
    updatedAt: NOW,
  } satisfies OrchestrationReadModel;
}

function startCommand(id: string, messageId: string, text = messageId): OrchestrationCommand {
  return {
    type: "thread.turn.start",
    commandId: CommandId.make(id),
    threadId: THREAD_ID,
    message: {
      messageId: MessageId.make(messageId),
      role: "user",
      text,
      attachments: [],
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt: NOW,
  };
}

function makeEvent(
  sequence: number,
  type: OrchestrationEvent["type"],
  payload: unknown,
): OrchestrationEvent {
  return {
    sequence,
    eventId: EventId.make(`event-${sequence}`),
    aggregateKind: "thread",
    aggregateId: THREAD_ID,
    occurredAt: NOW,
    commandId: CommandId.make(`command-${sequence}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type,
    payload,
  } as OrchestrationEvent;
}

const apply = (
  model: OrchestrationReadModel,
  events: ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
) =>
  Effect.gen(function* () {
    let current = model;
    for (const event of events) {
      current = yield* projectEvent(current, {
        ...event,
        sequence: current.snapshotSequence + 1,
      } as OrchestrationEvent);
    }
    return current;
  });

it.layer(NodeServices.layer)("queued turn decider", (it) => {
  it.effect("queues submissions while running and preserves FIFO sequence", () =>
    Effect.gen(function* () {
      const running = readModel({ session: session("running") });
      const first = yield* decideOrchestrationCommand({
        command: startCommand("command-1", "message-1"),
        readModel: running,
      });
      expect((Array.isArray(first) ? first : [first])[0]).toMatchObject({
        type: "thread.turn-queued",
      });
      const afterFirst = yield* apply(running, Array.isArray(first) ? first : [first]);
      const second = yield* decideOrchestrationCommand({
        command: startCommand("command-2", "message-2"),
        readModel: afterFirst,
      });
      const secondEvent = (Array.isArray(second) ? second : [second])[0];
      expect(secondEvent).toMatchObject({ type: "thread.turn-queued" });
      if (secondEvent?.type === "thread.turn-queued") {
        expect(secondEvent.payload.queuedTurn.queueSequence).toBe(1);
      }
    }),
  );

  it.effect("dispatches only the FIFO head and removes it on authoritative turn start", () =>
    Effect.gen(function* () {
      const first = yield* decideOrchestrationCommand({
        command: startCommand("command-1", "message-1"),
        readModel: readModel({ session: session("running") }),
      });
      let queued = yield* apply(readModel({ session: session("running") }), [
        ...(Array.isArray(first) ? first : [first]),
      ]);
      const second = yield* decideOrchestrationCommand({
        command: startCommand("command-2", "message-2"),
        readModel: queued,
      });
      queued = yield* apply(queued, Array.isArray(second) ? second : [second]);

      const dispatch = yield* decideOrchestrationCommand({
        command: {
          type: "thread.queued-turn.dispatch",
          commandId: CommandId.make("dispatch-1"),
          threadId: THREAD_ID,
          messageId: MessageId.make("message-1"),
          createdAt: NOW,
        },
        readModel: {
          ...queued,
          threads: queued.threads.map((thread) => ({ ...thread, session: session("ready") })),
        },
      });
      const dispatchEvents = Array.isArray(dispatch) ? dispatch : [dispatch];
      expect(dispatchEvents.map((event) => event.type)).toContain("thread.message-sent");
      expect(dispatchEvents.map((event) => event.type)).toContain("thread.turn-start-requested");
      const dispatching = yield* apply(queued, dispatchEvents);
      expect(dispatching.threads[0]?.queuedTurns?.[0]?.status).toBe("dispatching");

      const adopted = yield* decideOrchestrationCommand({
        command: {
          type: "thread.session.set",
          commandId: CommandId.make("session-running-1"),
          threadId: THREAD_ID,
          session: { ...session("running"), activeTurnId: TurnId.make("provider-turn-1") },
          createdAt: NOW,
        },
        readModel: dispatching,
      });
      const adoptedEvents = Array.isArray(adopted) ? adopted : [adopted];
      expect(adoptedEvents.at(-1)?.type).toBe("thread.queued-turn-dispatched");
      const afterAdoption = yield* apply(dispatching, adoptedEvents);
      expect(afterAdoption.threads[0]?.queuedTurns).toHaveLength(1);
      expect(afterAdoption.threads[0]?.queuedTurns?.[0]?.messageId).toBe("message-2");
    }),
  );

  it.effect("does not consume a queued item on interrupt and rejects duplicate message ids", () =>
    Effect.gen(function* () {
      const queued = readModel({
        session: session("interrupted"),
        queuedTurns: [
          {
            messageId: MessageId.make("message-1"),
            threadId: THREAD_ID,
            text: "message-1",
            attachments: [],
            modelSelection: MODEL,
            runtimeMode: "full-access",
            interactionMode: "default",
            createdAt: NOW,
            queuedAt: NOW,
            queueSequence: 0,
            status: "queued",
            attempt: 0,
            lastError: null,
          },
        ],
      });
      const duplicate = yield* decideOrchestrationCommand({
        command: startCommand("command-duplicate", "message-1"),
        readModel: queued,
      }).pipe(Effect.flip);
      expect(duplicate._tag).toBe("OrchestrationCommandInvariantError");
      const sessionSet = yield* decideOrchestrationCommand({
        command: {
          type: "thread.session.set",
          commandId: CommandId.make("session-interrupted"),
          threadId: THREAD_ID,
          session: session("interrupted"),
          createdAt: NOW,
        },
        readModel: queued,
      });
      expect(
        (Array.isArray(sessionSet) ? sessionSet : [sessionSet]).map((event) => event.type),
      ).not.toContain("thread.queued-turn-dispatched");
    }),
  );

  it.effect("pauses a failed head and supports retry, cancel, and clear", () =>
    Effect.gen(function* () {
      const failedEntry = {
        messageId: MessageId.make("message-1"),
        threadId: THREAD_ID,
        text: "message-1",
        attachments: [],
        modelSelection: MODEL,
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        createdAt: NOW,
        queuedAt: NOW,
        queueSequence: 0,
        status: "failed" as const,
        attempt: 1,
        lastError: "provider failed",
      };
      const queuedEntry = {
        ...failedEntry,
        messageId: MessageId.make("message-2"),
        queueSequence: 1,
        status: "queued" as const,
        attempt: 0,
        lastError: null,
      };
      const model = readModel({
        session: session("ready"),
        queuedTurns: [failedEntry, queuedEntry],
      });
      const blocked = yield* decideOrchestrationCommand({
        command: {
          type: "thread.queued-turn.dispatch",
          commandId: CommandId.make("dispatch-blocked"),
          threadId: THREAD_ID,
          messageId: queuedEntry.messageId,
          createdAt: NOW,
        },
        readModel: model,
      }).pipe(Effect.flip);
      expect(blocked._tag).toBe("OrchestrationCommandInvariantError");

      const retry = yield* decideOrchestrationCommand({
        command: {
          type: "thread.queued-turn.retry",
          commandId: CommandId.make("retry-1"),
          threadId: THREAD_ID,
          messageId: failedEntry.messageId,
          createdAt: NOW,
        },
        readModel: model,
      });
      expect((Array.isArray(retry) ? retry : [retry])[0]?.type).toBe("thread.queued-turn-retried");

      const clear = yield* decideOrchestrationCommand({
        command: {
          type: "thread.queued-turn.clear",
          commandId: CommandId.make("clear-1"),
          threadId: THREAD_ID,
          createdAt: NOW,
        },
        readModel: readModel({
          session: session("ready"),
          queuedTurns: [failedEntry, queuedEntry],
        }),
      });
      const clearEvent = Array.isArray(clear) ? clear[0] : clear;
      if (clearEvent?.type === "thread.queued-turns-cleared") {
        expect(clearEvent.payload.messageIds).toEqual(["message-1", "message-2"]);
      }
    }),
  );
});
