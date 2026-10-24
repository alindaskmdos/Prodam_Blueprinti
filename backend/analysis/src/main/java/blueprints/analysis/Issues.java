package blueprints.analysis;

import blueprints.model.Issue;
import blueprints.model.Span;
import com.github.javaparser.ast.Node;
import java.util.List;

/**
 * Сборка {@link Issue} для детекторов: id {@code rule:methodId:строка:колонка}, span по узлу, source=blueprints, ops при {@link ProjectAnalysis#n()} проекта метода.
 * blockId пуст — его подставляет app по совпадению диапазона строк (decisions.md); fixes пусты — их добавляет слой фиксов.
 */
public final class Issues {
    /** n по умолчанию для opsBefore/opsAfter (§8.4), если {@link ProjectAnalysis#of} вызван без n. */
    public static final long DEFAULT_N = 10_000;

    private Issues() {}

    /** before/after — оценка участка до и после рекомендации (before == null — без блока complexity). */
    public static Issue of(String rule, String severity, String confidence, MethodAnalysis m, Node at,
                           String message, String recommendation, BigO before, BigO after) {
        Span span = span(m, at);
        long n = m.project().n();
        Issue.Complexity c = before == null ? null : new Issue.Complexity(before.toString(),
                after == null ? null : after.toString(), before.ops(n), after == null ? null : after.ops(n));
        int col = at.getBegin().map(p -> p.column).orElse(0);
        return new Issue(rule + ":" + m.id() + ":" + span.startLine() + ":" + col, rule, severity, confidence, "blueprints", span,
                m.id(), null, message, recommendation, c, List.of());
    }

    static Span span(MethodAnalysis m, Node at) {
        int b = at.getBegin().map(p -> p.line).orElse(m.span().startLine());
        return new Span(m.file(), b, at.getEnd().map(p -> p.line).orElse(b));
    }

    /** Короткое имя символа (часть ключа после «|»): {@code com.demo.OrderService|orders} → {@code orders}. */
    public static String shortName(String symbol) {
        return symbol.substring(symbol.indexOf('|') + 1);
    }
}
