// Run: npm test
import assert from "node:assert/strict";
import { parseIssueKey } from "./rpc.ts";

assert.equal(parseIssueKey("ABC-123"), "ABC-123");
assert.equal(parseIssueKey("  abc-123 "), "ABC-123");
assert.equal(parseIssueKey("https://example.atlassian.net/browse/GPS-42"), "GPS-42");
assert.equal(parseIssueKey("https://x.atlassian.net/browse/gps-42?focusedCommentId=1"), "GPS-42");
assert.equal(parseIssueKey("fix login ABC-123"), null);
assert.equal(parseIssueKey("ABC"), null);
assert.equal(parseIssueKey(""), null);
console.log("parseIssueKey ok");
