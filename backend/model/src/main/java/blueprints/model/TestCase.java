package blueprints.model;

import java.util.List;

/** type: io|junit; mode: original|manual (io); source — текст tests/*.java (junit). expected: null — ожидания нет. */
public record TestCase(String name, String type, String stdin, String mode, String expected,
                       List<Integer> ignoreLines, String source) {}
