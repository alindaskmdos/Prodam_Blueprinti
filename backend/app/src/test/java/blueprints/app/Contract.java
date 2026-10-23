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
    private static JsonNode components;

    private Contract() {}

    static synchronized void validate(String schema, JsonNode json) {
        try {
            if (components == null) {
                Object doc = new Yaml().load(Files.readString(DIR.resolve("openapi.yaml")));
                components = JSON.valueToTree(doc).get("components");
            }
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        ObjectNode root = JSON.createObjectNode();
        root.put("$ref", "#/components/schemas/" + schema);
        root.set("components", components);
        Set<ValidationMessage> errors = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V4).getSchema(root).validate(json);
        assertTrue(errors.isEmpty(), schema + ": " + errors + "\n" + json);
    }

    static JsonNode fixture(String name) throws IOException {
        return JSON.readTree(Files.readString(DIR.resolve("fixtures").resolve(name)));
    }
}
