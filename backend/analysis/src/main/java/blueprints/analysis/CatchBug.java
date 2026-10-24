package blueprints.analysis;

import blueprints.model.Issue;
import com.github.javaparser.ast.stmt.CatchClause;
import com.github.javaparser.ast.stmt.ThrowStmt;
import com.github.javaparser.ast.type.ClassOrInterfaceType;
import com.github.javaparser.ast.type.Type;
import com.github.javaparser.ast.type.UnionType;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * §8.3: catch, маскирующий баг. По Throwable/Error (глотает OutOfMemoryError, StackOverflowError) → severity high;
 * по исключению-ошибке программиста (NPE, выход за границы, ClassCast, Arithmetic) → medium. Тип — по простому имени,
 * multi-catch тоже; одна находка на catch (span — он), все такие типы в message. confidence high, без complexity и fixes.
 */
public final class CatchBug implements Detector {
    private static final Set<String> FATAL = Set.of("Throwable", "Error");
    private static final Set<String> PROGRAMMER = Set.of("NullPointerException", "ArrayIndexOutOfBoundsException",
            "IndexOutOfBoundsException", "StringIndexOutOfBoundsException", "ClassCastException", "ArithmeticException");

    @Override
    public String id() {
        return "CatchBug";
    }

    @Override
    public List<Issue> detect(MethodAnalysis m, ProjectAnalysis project) {
        List<Issue> out = new ArrayList<>();
        for (CatchClause c : m.declaration().findAll(CatchClause.class)) {
            if (!c.getBody().findAll(ThrowStmt.class).isEmpty()) continue; // проброс или обёртка — не маскирует
            Type t = c.getParameter().getType();
            List<Type> types = t instanceof UnionType u ? new ArrayList<>(u.getElements()) : List.of(t);
            List<String> fatal = new ArrayList<>();
            List<String> bugs = new ArrayList<>();
            for (Type x : types) {
                if (!(x instanceof ClassOrInterfaceType ct)) continue;
                String name = ct.getNameAsString();
                if (FATAL.contains(name)) fatal.add(name);
                else if (PROGRAMMER.contains(name)) bugs.add(name);
            }
            if (fatal.isEmpty() && bugs.isEmpty()) continue;
            List<String> all = new ArrayList<>(fatal);
            all.addAll(bugs);
            String names = String.join(", ", all);
            String message = fatal.isEmpty()
                    ? "Перехват " + names + " маскирует ошибку программиста — баг станет «нормальной» веткой"
                    : "Перехват " + names + " глотает фатальные ошибки JVM (OutOfMemoryError, StackOverflowError)"
                            + (bugs.isEmpty() ? "" : " и ошибки программиста");
            String recommendation = fatal.isEmpty()
                    ? "Устранить причину проверкой (null, границы индекса, instanceof, делитель ≠ 0) вместо перехвата. "
                            + "Было: try { x = a[i]; } catch (" + bugs.get(0) + " e) { … } → стало: if (i < a.length) x = a[i];"
                    : "Перехватывать конкретные исключения (Exception или уже). "
                            + "Было: catch (" + fatal.get(0) + " e) → стало: catch (IOException e)";
            out.add(Issues.of(id(), fatal.isEmpty() ? "medium" : "high", "high", m, c, message, recommendation, null, null));
        }
        return out;
    }
}
