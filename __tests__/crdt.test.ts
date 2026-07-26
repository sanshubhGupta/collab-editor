// __tests__/crdt.test.ts
import * as Y from "yjs";

describe("Yjs CRDT behavior", () => {
  test("two Y.Docs converge to the same state after concurrent edits", () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const textA = docA.getText("content");
    const textB = docB.getText("content");

    // Simulate two clients editing independently, offline from each other.
    textA.insert(0, "Hello");
    textB.insert(0, "World");

    // Exchange updates both ways — this is what your WebSocket server does
    // via broadcast, just without the network in between for this test.
    const updateFromA = Y.encodeStateAsUpdate(docA);
    const updateFromB = Y.encodeStateAsUpdate(docB);

    Y.applyUpdate(docB, updateFromA);
    Y.applyUpdate(docA, updateFromB);

    // Convergence: both docs must now agree on content, regardless of the
    // order operations happened in — this is the entire point of a CRDT.
    expect(textA.toString()).toBe(textB.toString());
    expect(textA.toString().length).toBe(10); // "Hello" + "World", 5 chars each
  });

  test("applying the same update twice is idempotent", () => {
    const doc = new Y.Doc();
    const text = doc.getText("content");
    text.insert(0, "Idempotent test");

    const update = Y.encodeStateAsUpdate(doc);

    const receiverDoc = new Y.Doc();
    const receiverText = receiverDoc.getText("content");

    Y.applyUpdate(receiverDoc, update);
    const stateAfterFirstApply = receiverText.toString();

    // Apply the exact same update a second time — simulates a duplicate
    // network delivery (e.g. a retry after an ack was lost). Yjs updates
    // carry their own operation IDs, so reapplying a known update must be
    // a safe no-op, not a duplicate insertion.
    Y.applyUpdate(receiverDoc, update);
    const stateAfterSecondApply = receiverText.toString();

    expect(stateAfterSecondApply).toBe(stateAfterFirstApply);
    expect(stateAfterSecondApply).toBe("Idempotent test");
  });

  test("a client's offline edits merge correctly after reconnecting via state-vector exchange", () => {
    const serverDoc = new Y.Doc();
    const serverText = serverDoc.getText("content");
    serverText.insert(0, "Shared start. ");

    // Client starts from the same state as the server (simulates an
    // initial sync-state, like your join-document handler sends).
    const clientDoc = new Y.Doc();
    Y.applyUpdate(clientDoc, Y.encodeStateAsUpdate(serverDoc));

    // Client goes offline and keeps editing locally.
    const clientText = clientDoc.getText("content");
    clientText.insert(clientText.length, "Client offline edit.");

    // Meanwhile, the server (with other connected clients) also changes.
    serverText.insert(serverText.length, " Server-side edit.");

    // Client reconnects. Real state-vector exchange: the client sends its
    // state vector, the server computes only the delta the client is
    // missing (not the whole document), and vice versa — this is exactly
    // what makes CRDT sync bandwidth-efficient rather than resending
    // everything on every reconnect.
    const clientStateVector = Y.encodeStateVector(clientDoc);
    const missingFromClient = Y.encodeStateAsUpdate(serverDoc, clientStateVector);
    Y.applyUpdate(clientDoc, missingFromClient);

    const serverStateVector = Y.encodeStateVector(serverDoc);
    const missingFromServer = Y.encodeStateAsUpdate(clientDoc, serverStateVector);
    Y.applyUpdate(serverDoc, missingFromServer);

    // Both sides must now contain both edits, and agree with each other.
    expect(clientText.toString()).toBe(serverText.toString());
    expect(clientText.toString()).toContain("Client offline edit.");
    expect(clientText.toString()).toContain("Server-side edit.");
  });
});