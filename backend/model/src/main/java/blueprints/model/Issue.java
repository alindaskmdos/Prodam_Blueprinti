package blueprints.model;

import java.util.List;

/**
 * severity: high|medium|low; confidence: high|low; source: blueprints|PMD.
 * Находка уровня класса/проекта (например CyclicDependency): methodId и blockId — null, classIds — FQN затронутых классов.
 * classIds у находок метода — null (ключа нет).
 */
public record Issue(String id, String rule, String severity, String confidence, String source, Span span,
                    String methodId, String blockId, String message, String recommendation,
                    Complexity complexity, List<String> fixes, List<String> classIds) {

    public Issue {
        fixes = fixes == null ? List.of() : List.copyOf(fixes);
        classIds = classIds == null ? null : List.copyOf(classIds);
    }

    /** Находка метода (без classIds). */
    public Issue(String id, String rule, String severity, String confidence, String source, Span span,
                 String methodId, String blockId, String message, String recommendation,
                 Complexity complexity, List<String> fixes) {
        this(id, rule, severity, confidence, source, span, methodId, blockId, message, recommendation, complexity, fixes, null);
    }

    /** opsBefore/opsAfter — Number, чтобы целые из JSON писались обратно целыми. */
    public record Complexity(String before, String after, Number opsBefore, Number opsAfter) {}
}
