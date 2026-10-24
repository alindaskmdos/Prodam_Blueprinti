package blueprints.analysis;

import blueprints.model.Issue;
import com.github.javaparser.ast.stmt.BlockStmt;
import com.github.javaparser.ast.stmt.CatchClause;
import com.github.javaparser.ast.type.Type;
import com.github.javaparser.ast.type.UnionType;
import java.util.ArrayList;
import java.util.List;

/**
 * §8.3: пустой catch — исключение перехватывается и молча теряется. Одна находка на catch-клаузу (span — она),
 * severity medium. Совсем пустое тело → confidence high; без операторов, но с комментарием (возможно, намеренно) → low.
 * catch с любым оператором (даже {@code ;}) не сообщается. Без complexity и fixes.
 */
public final class EmptyCatch implements Detector {
    @Override
    public String id() {
        return "EmptyCatch";
    }

    @Override
    public List<Issue> detect(MethodAnalysis m, ProjectAnalysis project) {
        List<Issue> out = new ArrayList<>();
        for (CatchClause c : m.declaration().findAll(CatchClause.class)) {
            BlockStmt body = c.getBody();
            if (!body.getStatements().isEmpty()) continue;
            boolean commented = !body.getAllContainedComments().isEmpty() || body.getComment().isPresent();
            Type t = c.getParameter().getType();
            String type = t instanceof UnionType u
                    ? String.join(" | ", u.getElements().stream().map(Type::asString).toList()) : t.asString();
            out.add(Issues.of(id(), "medium", commented ? "low" : "high", m, c,
                    "Исключение " + type + " перехватывается и молча игнорируется"
                            + (commented ? " (в теле только комментарий — возможно, намеренно)" : ""),
                    "Залогировать, пробросить или обработать исключение; если игнорирование намеренно — объяснить почему. "
                            + "Было: catch (" + type + " e) {} → стало: catch (" + type + " e) { log.warn(\"…\", e); }"
                            + " или catch (" + type + " e) { throw new IllegalStateException(e); }",
                    null, null));
        }
        return out;
    }
}
