package site.syamdev.shush.matching;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import site.syamdev.shush.conversation.Conversation;
import site.syamdev.shush.conversation.ConversationRepository;
import site.syamdev.shush.support.AbstractIT;
import site.syamdev.shush.support.TestUsers;
import site.syamdev.shush.support.WsClient;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class MatchingIT extends AbstractIT {

    private static final short MUSIC = 1;
    private static final short GAMING = 2;
    private static final short GARDENING = 24;

    @LocalServerPort
    private int port;

    @Autowired
    private ConversationRepository conversations;

    @Autowired
    private WaitPool pool;

    @Test
    void twoUsersWithOverlappingInterestsAreMatchedOnThoseInterests() throws Exception {
        TestUsers.Session alice = testUsers.newAnonymous();
        TestUsers.Session bob = testUsers.newAnonymous();

        try (WsClient aliceWs = WsClient.connect(port, alice.jwt());
             WsClient bobWs = WsClient.connect(port, bob.jwt())) {
            aliceWs.await("hello");
            bobWs.await("hello");

            find(aliceWs, List.of(MUSIC, GAMING), 0);
            find(bobWs, List.of(GAMING, GARDENING), 0);

            JsonNode asAlice = aliceWs.await("matched");
            JsonNode asBob = bobWs.await("matched");

            assertThat(asAlice.path("conversationId").asText())
                    .isEqualTo(asBob.path("conversationId").asText());
            assertThat(asAlice.path("withUserId").asText()).isEqualTo(bob.userId().toString());
            assertThat(asBob.path("withUserId").asText()).isEqualTo(alice.userId().toString());

            assertThat(asAlice.path("randomMatch").asBoolean())
                    .as("they share an interest, so this is not a random match")
                    .isFalse();
            assertThat(asAlice.path("sharedInterestIds").get(0).asInt()).isEqualTo(GAMING);

            Conversation conversation = conversations
                    .findById(UUID.fromString(asAlice.path("conversationId").asText())).orElseThrow();
            assertThat(conversation.getMatchedOn()).containsExactly(GAMING);
            assertThat(conversation.wasRandomMatch()).isFalse();
        }
    }

    /**
     * The point of the whole feature: two strangers who each typed a tag nobody curated still
     * end up on the same shared row, and matching cannot tell that apart from a tag that shipped
     * on day one. If this test needs anything special to pass, the design is wrong.
     */
    @Test
    void twoStrangersWithTheSameCustomTagAreMatchedOnIt() throws Exception {
        TestUsers.Session alice = testUsers.newAnonymous();
        TestUsers.Session bob = testUsers.newAnonymous();

        short tagId = (short) rest.exchange("/api/interests", org.springframework.http.HttpMethod.POST,
                        new org.springframework.http.HttpEntity<>(
                                java.util.Map.of("label", "Competitive Origami"),
                                testUsers.authorised(alice)),
                        JsonNode.class)
                .getBody().path("id").asInt();

        try (WsClient aliceWs = WsClient.connect(port, alice.jwt());
             WsClient bobWs = WsClient.connect(port, bob.jwt())) {
            aliceWs.await("hello");
            bobWs.await("hello");

            find(aliceWs, List.of(tagId), 0);
            find(bobWs, List.of(tagId), 0);

            JsonNode asAlice = aliceWs.await("matched");
            assertThat(asAlice.path("randomMatch").asBoolean()).isFalse();
            assertThat(asAlice.path("sharedInterestIds").get(0).asInt()).isEqualTo(tagId);
        }
    }

    /**
     * The five-second option is honest about what it is: try for a shared interest, then give
     * me anyone. When Shush is quiet that means a random person, and the conversation says so.
     */
    @Test
    void whenPatienceRunsOutTheMatchIsRandomAndSaysSo() throws Exception {
        TestUsers.Session alice = testUsers.newAnonymous();
        TestUsers.Session bob = testUsers.newAnonymous();

        try (WsClient aliceWs = WsClient.connect(port, alice.jwt());
             WsClient bobWs = WsClient.connect(port, bob.jwt())) {
            aliceWs.await("hello");
            bobWs.await("hello");

            // Nothing in common at all, so only patience can pair them.
            find(aliceWs, List.of(MUSIC), 5);
            find(bobWs, List.of(GARDENING), 5);

            JsonNode asAlice = aliceWs.await("matched");
            JsonNode asBob = bobWs.await("matched");

            assertThat(asAlice.path("conversationId").asText())
                    .isEqualTo(asBob.path("conversationId").asText());
            assertThat(asAlice.path("randomMatch").asBoolean()).isTrue();
            assertThat(asAlice.path("sharedInterestIds").isNull()).isTrue();

            Conversation conversation = conversations
                    .findById(UUID.fromString(asAlice.path("conversationId").asText())).orElseThrow();
            assertThat(conversation.getMatchedOn())
                    .as("matched_on is null for a random match, and the null is meaningful")
                    .isNull();
        }
    }

    /**
     * Zero patience means "only somebody who actually shares an interest, however long that
     * takes" -- so with nothing in common, nothing should happen at all.
     */
    @Test
    void waitingIndefinitelyNeverSettlesForARandomMatch() throws Exception {
        TestUsers.Session alice = testUsers.newAnonymous();
        TestUsers.Session bob = testUsers.newAnonymous();

        try (WsClient aliceWs = WsClient.connect(port, alice.jwt());
             WsClient bobWs = WsClient.connect(port, bob.jwt())) {
            aliceWs.await("hello");
            bobWs.await("hello");

            find(aliceWs, List.of(MUSIC), 0);
            find(bobWs, List.of(GARDENING), 0);

            org.awaitility.Awaitility.await()
                    .during(java.time.Duration.ofSeconds(3))
                    .atMost(java.time.Duration.ofSeconds(4))
                    .untilAsserted(() -> {
                        assertThat(pool.isWaiting(alice.userId())).isTrue();
                        assertThat(pool.isWaiting(bob.userId())).isTrue();
                    });

            aliceWs.send("{\"type\":\"cancelFind\"}");
            bobWs.send("{\"type\":\"cancelFind\"}");
        }
    }

    /**
     * One stranger conversation at a time. Matching again walks out of the one still open, and
     * the person left behind in it is told, the same way Leave would have told them.
     */
    @Test
    void aNewMatchEndsTheConversationItReplaces() throws Exception {
        TestUsers.Session alice = testUsers.newAnonymous();
        TestUsers.Session bob = testUsers.newAnonymous();
        TestUsers.Session carol = testUsers.newAnonymous();

        try (WsClient aliceWs = WsClient.connect(port, alice.jwt());
             WsClient bobWs = WsClient.connect(port, bob.jwt());
             WsClient carolWs = WsClient.connect(port, carol.jwt())) {
            aliceWs.await("hello");
            bobWs.await("hello");
            carolWs.await("hello");

            find(aliceWs, List.of(GARDENING), 0);
            find(bobWs, List.of(GARDENING), 0);
            UUID first = UUID.fromString(aliceWs.await("matched").path("conversationId").asText());
            bobWs.await("matched");

            find(aliceWs, List.of(GARDENING), 0);
            find(carolWs, List.of(GARDENING), 0);
            UUID second = UUID.fromString(aliceWs.await("matched").path("conversationId").asText());
            assertThat(second).isNotEqualTo(first);

            JsonNode left = bobWs.await("left");
            assertThat(left.path("conversationId").asText()).isEqualTo(first.toString());
            assertThat(left.path("userId").asText()).isEqualTo(alice.userId().toString());

            assertThat(conversations.findById(first).orElseThrow().getState())
                    .isEqualTo(Conversation.State.ENDED);
            assertThat(conversations.findById(second).orElseThrow().getState())
                    .isEqualTo(Conversation.State.ACTIVE);

            // Over means over: the thread bob was left in no longer takes messages.
            bobWs.sendText(first, UUID.randomUUID(), "still there?");
            assertThat(bobWs.await("error").path("code").asText()).isEqualTo("conversation_ended");
        }
    }

    @Test
    void closingTheSocketTakesYouOutOfThePool() throws Exception {
        TestUsers.Session alice = testUsers.newAnonymous();

        try (WsClient aliceWs = WsClient.connect(port, alice.jwt())) {
            aliceWs.await("hello");
            find(aliceWs, List.of(MUSIC), 0);

            org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(5))
                    .untilAsserted(() -> assertThat(pool.isWaiting(alice.userId())).isTrue());
        }

        // Matching someone who has closed the tab would burn a waiting stranger on a
        // conversation nobody is there to have.
        org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(5))
                .untilAsserted(() -> assertThat(pool.isWaiting(alice.userId())).isFalse());
    }

    /**
     * The dial promises an answer in five seconds, so five seconds is when one arrives -- even
     * when the answer is nobody.
     *
     * <p>Before this, the window governed only *how* we matched: after it elapsed we stopped
     * holding out for a shared interest and took anyone. With an empty pool that found nothing
     * either and the searcher simply stayed in it, watching "Still looking" against a setting
     * that had said five seconds. A patience setting the product cannot honour is worse than
     * not offering one.
     */
    @Test
    void aSearchWithNobodyToFindEndsItselfWhenPatienceRunsOut() throws Exception {
        TestUsers.Session alice = testUsers.newAnonymous();

        try (WsClient aliceWs = WsClient.connect(port, alice.jwt())) {
            aliceWs.await("hello");
            find(aliceWs, List.of(MUSIC), 5);

            aliceWs.await("noMatch");

            assertThat(pool.isWaiting(alice.userId()))
                    .as("giving up means leaving the pool, not just telling the client")
                    .isFalse();
        }
    }

    /**
     * Friends are candidates like anybody else.
     *
     * <p>They used to be excluded, which was defensible until the pool was small: keep two or
     * three people and the matcher starts refusing the only people who are ever around. Worse,
     * it was one-way -- once two accounts had kept each other, nothing could ever put them
     * together again. The conversation simply does not offer to keep someone already kept; see
     * the web client, which decides that from the friends list rather than from a flag.
     */
    @Test
    void twoPeopleWhoAreAlreadyFriendsCanStillBeMatched() throws Exception {
        TestUsers.Session alice = testUsers.newAnonymous();
        TestUsers.Session bob = testUsers.newAnonymous();

        UUID conversationId = testUsers.createConversation(alice, bob);
        JsonNode request = rest.exchange(
                        "/api/conversations/" + conversationId + "/friend-request",
                        org.springframework.http.HttpMethod.POST,
                        new org.springframework.http.HttpEntity<>(null, testUsers.authorised(alice)),
                        JsonNode.class)
                .getBody();
        rest.exchange("/api/friend-requests/" + request.path("id").asText() + "/accept",
                org.springframework.http.HttpMethod.POST,
                new org.springframework.http.HttpEntity<>(null, testUsers.authorised(bob)),
                JsonNode.class);

        try (WsClient aliceWs = WsClient.connect(port, alice.jwt());
             WsClient bobWs = WsClient.connect(port, bob.jwt())) {
            aliceWs.await("hello");
            bobWs.await("hello");

            find(aliceWs, List.of(GAMING), 0);
            find(bobWs, List.of(GAMING), 0);

            JsonNode asAlice = aliceWs.await("matched");
            assertThat(asAlice.path("withUserId").asText()).isEqualTo(bob.userId().toString());
            assertThat(bobWs.await("matched").path("withUserId").asText())
                    .isEqualTo(alice.userId().toString());
        }
    }

    private static void find(WsClient client, List<Short> interestIds, int patience) throws Exception {
        String ids = interestIds.stream().map(String::valueOf).reduce((a, b) -> a + "," + b).orElse("");
        client.send("{\"type\":\"find\",\"interestIds\":[" + ids + "],\"patience\":" + patience + "}");
    }
}
