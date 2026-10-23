package blueprints.model;

import java.util.List;

/** severity: high|medium|low; confidence: high|low; source: blueprints|PMD. */
public record Issue(String id, String rule, String severity, String confidence, String source, Span span,
                    String methodId, String blockId, String message, String recommendation,
                    Complexity complexity, List<String> fixes) {

    public Issue {
        fixes = fixes == null ? List.of() : List.copyOf(fixes);
    }

    /** opsBefore/opsAfter — Number, чтобы целые из JSON писались обратно целыми. */
    public record Complexity(String before, String after, Number opsBefore, Number opsAfter) {}
}
