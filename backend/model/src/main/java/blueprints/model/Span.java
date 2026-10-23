package blueprints.model;

/** Строки с 1, обе границы включительно. */
public record Span(String file, int startLine, int endLine) {}
