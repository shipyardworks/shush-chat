package site.syamdev.shush.user;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import site.syamdev.shush.support.AbstractIT;
import site.syamdev.shush.support.TestUsers;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class InterestIT extends AbstractIT {

    @Test
    void aFirstTimeVisitorSeesTheFiveMostPopular() {
        JsonNode body = rest.getForObject("/api/interests", JsonNode.class);

        assertThat(body.path("suggested")).hasSize(5);
        assertThat(body.path("fromHistory").asBoolean()).isFalse();
        assertThat(slugsOf(body.path("suggested")))
                .containsExactly("music", "gaming", "movies", "books", "food");
        assertThat(body.path("all").size()).isGreaterThan(5);
    }

    @Test
    void aReturningVisitorSeesTheirOwnInterests() {
        TestUsers.Session session = testUsers.newAnonymous();

        ResponseEntity<Void> saved = rest.exchange("/api/interests/mine", HttpMethod.PUT,
                new HttpEntity<>(Map.of("interestIds", List.of(21, 25)), testUsers.authorised(session)),
                Void.class);
        assertThat(saved.getStatusCode()).isEqualTo(HttpStatus.OK);

        ResponseEntity<JsonNode> body = rest.exchange("/api/interests", HttpMethod.GET,
                new HttpEntity<>(testUsers.authorised(session)), JsonNode.class);

        assertThat(body.getBody().path("fromHistory").asBoolean()).isTrue();
        assertThat(slugsOf(body.getBody().path("suggested")))
                .containsExactlyInAnyOrder("space", "philosophy");
    }

    /**
     * The whole point of this endpoint: two people typing the same tag, in different case and
     * with different spacing, end up pointing at one row -- which is what lets the matcher tell
     * them later that they share it. There is no per-user copy to keep separate.
     */
    @Test
    void twoDifferentSpellingsOfTheSameTagShareOneRow() {
        TestUsers.Session alice = testUsers.newAnonymous();
        TestUsers.Session bob = testUsers.newAnonymous();

        JsonNode fromAlice = create("Xabc", alice);
        JsonNode fromBob = create("  xabc  ", bob);

        assertThat(fromBob.path("id").asInt()).isEqualTo(fromAlice.path("id").asInt());
        assertThat(fromAlice.path("label").asText())
                .as("the first spelling to arrive is the one everyone sees")
                .isEqualTo("Xabc");
    }

    @Test
    void aBlankTagIsRefused() {
        TestUsers.Session session = testUsers.newAnonymous();
        assertThat(rest.exchange("/api/interests", HttpMethod.POST,
                new HttpEntity<>(Map.of("label", "   "), testUsers.authorised(session)), Void.class)
                .getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    void aCustomTagIsAnOrdinaryInterestOnceCreated() {
        TestUsers.Session session = testUsers.newAnonymous();
        JsonNode created = create("Competitive Origami", session);
        int id = created.path("id").asInt();

        ResponseEntity<Void> saved = rest.exchange("/api/interests/mine", HttpMethod.PUT,
                new HttpEntity<>(Map.of("interestIds", List.of(id)), testUsers.authorised(session)),
                Void.class);
        assertThat(saved.getStatusCode())
                .as("nothing distinguishes it from a curated interest to the rest of the system")
                .isEqualTo(HttpStatus.OK);
    }

    private JsonNode create(String label, TestUsers.Session caller) {
        ResponseEntity<JsonNode> response = rest.exchange("/api/interests", HttpMethod.POST,
                new HttpEntity<>(Map.of("label", label), testUsers.authorised(caller)), JsonNode.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        return response.getBody();
    }

    private static List<String> slugsOf(JsonNode array) {
        List<String> slugs = new ArrayList<>();
        array.forEach(node -> slugs.add(node.path("slug").asText()));
        return slugs;
    }
}
