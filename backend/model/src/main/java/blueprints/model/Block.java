package blueprints.model;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Узел дерева метода. kind — строка из контракта (method, var, if, ... raw).
 * fields и slots упорядочены (LinkedHashMap); span может быть null у вновь созданных нод.
 */
public record Block(String id, String kind, Map<String, String> fields, Map<String, List<Block>> slots,
                    Span span, List<String> issues, boolean collapsed) {

    public Block {
        fields = fields == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(fields));
        slots = slots == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(slots));
        issues = issues == null ? List.of() : List.copyOf(issues);
    }

    public Block(String id, String kind, Map<String, String> fields, Map<String, List<Block>> slots, Span span) {
        this(id, kind, fields, slots, span, List.of(), false);
    }
}
