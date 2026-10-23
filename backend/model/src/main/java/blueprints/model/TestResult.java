package blueprints.model;

import java.util.List;

/** status: passed|failed|compile_error|original_fails. */
public record TestResult(String name, String type, String status, long durationMs, String error,
                         String expected, String actual, List<Integer> noisyLines) {}
