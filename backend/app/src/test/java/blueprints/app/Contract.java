package blueprints.app;

import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SpecVersion;
import com.networknt.schema.ValidationMessage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import org.yaml.snakeyaml.Yaml;

/** Проверка JSON против схем components/schemas из contract/openapi.yaml. */
final class Contract {
    static final ObjectMapper JSON = new ObjectMapper();
    static final Path DIR = Path.of("../../contract"); // тесты идут с cwd = backend/app
    private static JsonNode doc;

    private Contract() {}

    static void validate(String schema, JsonNode json) {
        check(schema, JSON.createObjectNode().put("$ref", "#/components/schemas/" + schema), json);
    }

    /** Схема ответа, описанная прямо в paths (например, /health). */
    static void validateResponse(String path, String method, String code, JsonNode json) {
        JsonNode schema = doc().get("paths").get(path).get(method).get("responses").get(code)
                .get("content").get("application/json").get("schema");
        check(method + " " + path, schema.deepCopy(), json);
    }

    private static synchronized JsonNode doc() {
        try {
            if (doc == null) doc = JSON.valueToTree(new Yaml().load(Files.readString(DIR.resolve("openapi.yaml"))));
            return doc;
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private static void check(String name, ObjectNode root, JsonNode json) {
        root.set("components", doc().get("components"));
        Set<ValidationMessage> errors = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V4).getSchema(root).validate(json);
        assertTrue(errors.isEmpty(), name + ": " + errors + "\n" + json);
    }

    static JsonNode fixture(String name) throws IOException {
        return JSON.readTree(Files.readString(DIR.resolve("fixtures").resolve(name)));
    }
}
