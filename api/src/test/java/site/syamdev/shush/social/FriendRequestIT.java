package site.syamdev.shush.social;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import site.syamdev.shush.conversation.Conversation;
import site.syamdev.shush.conversation.ConversationRepository;
import site.syamdev.shush.support.AbstractIT;
import site.syamdev.shush.support.TestUsers;
import site.syamdev.shush.support.WsClient;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class FriendRequestIT extends AbstractIT {

    @LocalServerPort
    private int port;

    @Autowired
    private ConversationRepository conversations;

    @Test
    void acceptingKeepsTheConversationAndMakesThemFriends() throws Exception {
        TestUsers.Session alice = testUsers.newAnonymous();
        TestUsers.Session bob = testUsers.newAnonymous();
        UUID conversationId = testUsers.createConversation(alice, bob);

        try (WsClient aliceWs = WsClient.connect(port, alice.jwt());
             WsClient bobWs = WsClient.connect(port, bob.jwt())) {
            aliceWs.await("hello");
            bobWs.await("hello");

            JsonNode request = post("/api/conversations/" + conversationId + "/friend-request",
                    null, alice).getBody();
            assertThat(request.path("status").asText()).isEqualTo("pending");

            JsonNode notified = bobWs.await("friendRequested");
            assertThat(notified.path("fromUserId").asText()).isEqualTo(alice.userId().toString());

            assertThat(post("/api/friend-requests/" + request.path("id").asText() + "/accept", null, bob)
                    .getStatusCode()).isEqualTo(HttpStatus.OK);

            JsonNode accepted = aliceWs.await("friendRequestAccepted");
            assertThat(accepted.path("byUserId").asText()).isEqualTo(bob.userId().toString());
        }

        Conversation conversation = conversations.findById(conversationId).orElseThrow();
        assertThat(conversation.getState()).isEqualTo(Conversation.State.KEPT);
        assertThat(conversation.getKind()).isEqualTo(Conversation.Kind.FRIEND);
        assertThat(conversation.getPurgeAfter())
                .as("a kept conversation is never on the purge clock")
                .isNull();

        assertThat(friendIdsOf(alice)).contains(bob.userId().toString());
        assertThat(friendIdsOf(bob)).contains(alice.userId().toString());
    }

    /**
     * Declining says nothing at all and cannot be re-asked. Both halves matter: an announced
     * decline would make leaving awkward, and a re-askable one would make it pointless.
     */
    @Test
    void decliningIsSilentAndCannotBeRepeated() throws Exception {
        TestUsers.Session alice = testUsers.newAnonymous();
        TestUsers.Session bob = testUsers.newAnonymous();
        UUID conversationId = testUsers.createConversation(alice, bob);

        try (WsClient aliceWs = WsClient.connect(port, alice.jwt());
             WsClient bobWs = WsClient.connect(port, bob.jwt())) {
            aliceWs.await("hello");
            bobWs.await("hello");

            String requestId = post("/api/conversations/" + conversationId + "/friend-request",
                    null, alice).getBody().path("id").asText();
            bobWs.await("friendRequested");

            assertThat(post("/api/friend-requests/" + requestId + "/decline", null, bob)
                    .getStatusCode()).isEqualTo(HttpStatus.OK);

            // Alice is told nothing. Proven by sending her something she *will* receive and
            // showing that is the next frame she sees.
            aliceWs.sendText(conversationId, UUID.randomUUID(), "still here");
            assertThat(aliceWs.await("message").path("body").asText()).isEqualTo("still here");
            assertThat(aliceWs.receivedSoFar().stream()
                    .map(frame -> frame.path("type").asText()))
                    .doesNotContain("friendRequestAccepted");

            // And she cannot simply ask again.
            ResponseEntity<JsonNode> again = post(
                    "/api/conversations/" + conversationId + "/friend-request", null, alice);
            assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
            assertThat(again.getBody().path("code").asText()).isEqualTo("already_requested");
        }

        assertThat(friendIdsOf(alice)).doesNotContain(bob.userId().toString());
        assertThat(conversations.findById(conversationId).orElseThrow().getPurgeAfter())
                .as("nobody ended up wanting this conversation, so it goes back on the clock")
                .isNotNull();
    }

    @Test
    void aRequestCanBeSentAfterTheConversationHasEnded() throws Exception {
        TestUsers.Session alice = testUsers.newAnonymous();
        TestUsers.Session bob = testUsers.newAnonymous();
        UUID conversationId = testUsers.createConversation(alice, bob);

        try (WsClient bobWs = WsClient.connect(port, bob.jwt())) {
            bobWs.await("hello");
            bobWs.send("{\"type\":\"leave\",\"conversationId\":\"" + conversationId + "\"}");

            org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(5))
                    .untilAsserted(() -> assertThat(
                            conversations.findById(conversationId).orElseThrow().getState())
                            .isEqualTo(Conversation.State.ENDED));
        }

        // The one thing that still works after someone has left, so a good chat is not lost
        // just because they closed their laptop first.
        assertThat(post("/api/conversations/" + conversationId + "/friend-request", null, alice)
                .getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    void aStrangerCannotAnswerSomeoneElsesRequest() {
        TestUsers.Session alice = testUsers.newAnonymous();
        TestUsers.Session bob = testUsers.newAnonymous();
        TestUsers.Session mallory = testUsers.newAnonymous();
        UUID conversationId = testUsers.createConversation(alice, bob);

        String requestId = post("/api/conversations/" + conversationId + "/friend-request", null, alice)
                .getBody().path("id").asText();

        ResponseEntity<JsonNode> response = post("/api/friend-requests/" + requestId + "/accept",
                null, mallory);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(response.getBody().path("code").asText()).isEqualTo("not_yours");
    }

    @Test
    void blockingSomeoneRemovesTheFriendshipAndTellsThem() throws Exception {
        TestUsers.Session alice = testUsers.newAnonymous();
        TestUsers.Session bob = testUsers.newAnonymous();
        UUID conversationId = testUsers.createConversation(alice, bob);

        String requestId = post("/api/conversations/" + conversationId + "/friend-request", null, alice)
                .getBody().path("id").asText();
        post("/api/friend-requests/" + requestId + "/accept", null, bob);
        assertThat(friendIdsOf(alice)).contains(bob.userId().toString());

        try (WsClient bobWs = WsClient.connect(port, bob.jwt())) {
            bobWs.await("hello");

            assertThat(post("/api/blocks/" + bob.userId(), null, alice).getStatusCode())
                    .isEqualTo(HttpStatus.OK);

            // One row, two people: the friendship is gone for both of them, and only the one
            // who blocked knew about it. Bob's friends list went on showing somebody who could
            // no longer reach him at all until something else made that client reload.
            JsonNode ended = bobWs.await("friendshipEnded");
            assertThat(ended.path("withUserId").asText()).isEqualTo(alice.userId().toString());
        }

        // Leaving the friendship in place would show someone you asked never to hear from again.
        assertThat(friendIdsOf(alice)).doesNotContain(bob.userId().toString());
        assertThat(friendIdsOf(bob)).doesNotContain(alice.userId().toString());
    }


    @Test
    void anInviteLinkOpensAConversationWithItsOwner() {
        TestUsers.Session alice = testUsers.newAnonymous();
        TestUsers.Session guest = testUsers.newAnonymous();

        String code = post("/api/invites", null, alice).getBody().path("code").asText();
        assertThat(code).isNotBlank();

        JsonNode accepted = post("/api/invites/" + code + "/accept", null, guest).getBody();
        UUID conversationId = UUID.fromString(accepted.path("conversationId").asText());

        assertThat(conversations.findById(conversationId)).isPresent();
        assertThat(post("/api/invites/" + code + "/accept", null, alice).getStatusCode())
                .as("your own link is not a way to talk to yourself")
                .isEqualTo(HttpStatus.BAD_REQUEST);
    }

    /**
     * The friends list carries how many messages are waiting from each person (pre-plan.md,
     * step 8), and the count is the maintained column rather than a COUNT(*) per friend.
     */
    @Test
    void theFriendsListSaysHowManyMessagesAreWaiting() throws Exception {
        TestUsers.Session alice = testUsers.newAnonymous();
        TestUsers.Session bob = testUsers.newAnonymous();
        UUID conversationId = befriend(alice, bob);

        try (WsClient aliceWs = WsClient.connect(port, alice.jwt())) {
            aliceWs.await("hello");
            aliceWs.sendText(conversationId, UUID.randomUUID(), "one");
            aliceWs.awaitAck("delivered");
            aliceWs.sendText(conversationId, UUID.randomUUID(), "two");
            aliceWs.awaitAck("delivered");
        }

        assertThat(friendsOf(bob).get(0).path("unreadCount").asInt())
                .as("two messages arrived while bob was away")
                .isEqualTo(2);
        assertThat(friendsOf(alice).get(0).path("unreadCount").asInt())
                .as("your own messages are never unread to you")
                .isZero();
    }

    /**
     * Removing a friend has to make that person matchable again. Matching skips anyone you are
     * already friends with, so while the friendship stands the pair can never be paired -- and
     * without this there was no way out of that at all.
     */
    @Test
    void removingAFriendUndoesTheExclusionThatBlocksMatching() throws Exception {
        TestUsers.Session alice = testUsers.newAnonymous();
        TestUsers.Session bob = testUsers.newAnonymous();
        befriend(alice, bob);

        assertThat(friendIdsOf(alice)).containsExactly(bob.userId().toString());

        try (WsClient bobWs = WsClient.connect(port, bob.jwt())) {
            bobWs.await("hello");

            assertThat(rest.exchange("/api/friends/" + bob.userId(), HttpMethod.DELETE,
                    new HttpEntity<>(testUsers.authorised(alice)), JsonNode.class).getStatusCode())
                    .isEqualTo(HttpStatus.OK);

            // The row is one row for two people, and only the one who deleted it knew. Bob's
            // friends list was left claiming a friendship that no longer existed until
            // something else happened to make that client reload.
            JsonNode ended = bobWs.await("friendshipEnded");
            assertThat(ended.path("withUserId").asText()).isEqualTo(alice.userId().toString());
        }

        assertThat(friendIdsOf(alice)).as("gone for the one who removed it").isEmpty();
        assertThat(friendIdsOf(bob)).as("and for the other one, since it was one row").isEmpty();

        assertThat(rest.exchange("/api/friends/" + bob.userId(), HttpMethod.DELETE,
                new HttpEntity<>(testUsers.authorised(alice)), JsonNode.class).getStatusCode())
                .as("removing a friendship that is not there is a bad request, not a crash")
                .isEqualTo(HttpStatus.BAD_REQUEST);
    }

    private UUID befriend(TestUsers.Session first, TestUsers.Session second) {
        UUID conversationId = testUsers.createConversation(first, second);
        JsonNode request = post("/api/conversations/" + conversationId + "/friend-request",
                null, first).getBody();
        assertThat(post("/api/friend-requests/" + request.path("id").asText() + "/accept",
                null, second).getStatusCode()).isEqualTo(HttpStatus.OK);
        return conversationId;
    }

    private java.util.List<JsonNode> friendsOf(TestUsers.Session caller) {
        ResponseEntity<JsonNode> response = rest.exchange("/api/friends", HttpMethod.GET,
                new HttpEntity<>(testUsers.authorised(caller)), JsonNode.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        java.util.List<JsonNode> friends = new java.util.ArrayList<>();
        response.getBody().forEach(friends::add);
        return friends;
    }

    private java.util.List<String> friendIdsOf(TestUsers.Session caller) {
        ResponseEntity<JsonNode> response = rest.exchange("/api/friends", HttpMethod.GET,
                new HttpEntity<>(testUsers.authorised(caller)), JsonNode.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        java.util.List<String> ids = new java.util.ArrayList<>();
        response.getBody().forEach(friend -> ids.add(friend.path("userId").asText()));
        return ids;
    }

    private ResponseEntity<JsonNode> post(String path, Map<String, ?> body, TestUsers.Session caller) {
        return rest.exchange(path, HttpMethod.POST,
                new HttpEntity<>(body, testUsers.authorised(caller)), JsonNode.class);
    }
}
