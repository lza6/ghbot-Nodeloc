import assert from "node:assert/strict";
import test from "node:test";
import type { Octokit } from "@octokit/rest";
import { EventRouter, type EventContext, type EventHandler } from "../src/actions/router.js";

const dummyOctokit = {} as Octokit;

test("EventRouter registers and dispatches matching events", async () => {
  const router = new EventRouter();
  const handledEvents: string[] = [];

  const prHandler: EventHandler = {
    name: "pull-request-handler",
    canHandle: (eventName) => eventName === "pull_request_target",
    handle: async (ctx) => {
      handledEvents.push(`${ctx.eventName}:${ctx.action}`);
    }
  };

  router.register(prHandler);

  const context: EventContext = {
    eventName: "pull_request_target",
    action: "opened",
    payload: { pull_request: { number: 1 } },
    octokit: dummyOctokit
  };

  const result = await router.dispatch(context);
  assert.equal(result.handled, true);
  assert.equal(result.handlerName, "pull-request-handler");
  assert.deepEqual(handledEvents, ["pull_request_target:opened"]);
});

test("EventRouter returns handled=false when no handler matches", async () => {
  const router = new EventRouter();
  const context: EventContext = {
    eventName: "unknown_event",
    payload: {},
    octokit: dummyOctokit
  };

  const result = await router.dispatch(context);
  assert.equal(result.handled, false);
  assert.equal(result.handlerName, undefined);
});

test("EventRouter respects handler registration order", async () => {
  const router = new EventRouter();
  const order: string[] = [];

  router.register({
    name: "first-handler",
    canHandle: (name) => name === "issue_comment",
    handle: async () => {
      order.push("first");
    }
  });

  router.register({
    name: "second-handler",
    canHandle: (name) => name === "issue_comment",
    handle: async () => {
      order.push("second");
    }
  });

  const result = await router.dispatch({
    eventName: "issue_comment",
    payload: {},
    octokit: dummyOctokit
  });

  assert.equal(result.handled, true);
  assert.equal(result.handlerName, "first-handler");
  assert.deepEqual(order, ["first"]);
});
