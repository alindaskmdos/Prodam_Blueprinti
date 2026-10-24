package blueprints.analysis;

import blueprints.model.Issue;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.body.CallableDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.body.TypeDeclaration;
import com.github.javaparser.ast.body.VariableDeclarator;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.ast.expr.MethodReferenceExpr;
import com.github.javaparser.ast.expr.NameExpr;
import com.github.javaparser.ast.expr.TypeExpr;
import com.github.javaparser.ast.expr.VariableDeclarationExpr;
import com.github.javaparser.ast.stmt.BlockStmt;
import com.github.javaparser.ast.stmt.ExpressionStmt;
import com.github.javaparser.ast.stmt.Statement;
import com.github.javaparser.ast.stmt.SwitchEntry;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * §14а.3 мёртвый код, только уверенные находки: приватный метод без вызова/ссылки {@code ::} по имени в своём
 * top-level классе (самовызов не в счёт), неиспользуемая локальная переменная-оператор, оператор после
 * return/throw/break/continue/yield в том же блоке или case. Неприватные методы не сообщаются вовсе (их могут звать
 * tests/*.java, внешний код, рефлексия). Приватный не сообщается: main, toString/equals/hashCode/compareTo, с аннотацией
 * (кроме @Deprecated/@SuppressWarnings/@SafeVarargs — фреймворки зовут рефлексией). Имя в строковом литерале проекта
 * (рефлексия) — confidence low. Перегрузки одной арности и лямбды — по имени: вызов любой перегрузки засчитывается всем.
 */
public final class DeadCode implements Detector {
    /** main, методы Object/Comparable и приватные методы сериализации, которые JVM вызывает рефлексией. */
    private static final Set<String> ALWAYS_USED = Set.of("main", "toString", "equals", "hashCode", "compareTo",
            "writeObject", "readObject", "readObjectNoData", "readResolve", "writeReplace");
    private static final Set<String> NEUTRAL_ANNOTATIONS = Set.of("Deprecated", "SuppressWarnings", "SafeVarargs");

    @Override
    public String id() {
        return "DeadCode";
    }

    @Override
    public List<Issue> detect(MethodAnalysis m, ProjectAnalysis project) {
        List<Issue> out = new ArrayList<>();
        CallableDeclaration<?> decl = m.declaration();
        if (decl instanceof MethodDeclaration md && md.isPrivate() && md.getBody().isPresent() && !ALWAYS_USED.contains(md.getNameAsString())
                && md.getAnnotations().stream().allMatch(a -> NEUTRAL_ANNOTATIONS.contains(a.getNameAsString()))
                && !calledIn(topLevel(m.owner()), md)) {
            boolean reflection = project.stringLiterals().contains(md.getNameAsString());
            out.add(Issues.of(id(), "low", reflection ? "low" : "high", m, md.getName(),
                    "Приватный метод «" + md.getNameAsString() + "» нигде не вызывается"
                            + (reflection ? " (имя есть в строке — возможно, рефлексия)" : ""), "Удалить метод", null, null));
        }
        for (VariableDeclarator v : decl.findAll(VariableDeclarator.class)) {
            if (!isLocalStatement(v, decl)) continue;
            String name = v.getNameAsString();
            // list::add — scope разбирается как TypeExpr, не NameExpr
            if (decl.findAll(NameExpr.class).stream().noneMatch(n -> n.getNameAsString().equals(name))
                    && decl.findAll(MethodReferenceExpr.class).stream().noneMatch(r -> r.getScope() instanceof TypeExpr t
                    && t.getType().asString().equals(name))) {
                out.add(Issues.of(id(), "low", "high", m, v, "Локальная переменная «" + name + "» не используется",
                        "Удалить переменную (вызов из инициализатора оставить, если нужен его побочный эффект)", null, null));
            }
        }
        for (Node block : decl.findAll(Node.class, n -> n instanceof BlockStmt || n instanceof SwitchEntry)) {
            if (block.findAncestor(CallableDeclaration.class).orElse(null) != decl) continue;
            List<Statement> stmts = block instanceof BlockStmt b ? b.getStatements() : ((SwitchEntry) block).getStatements();
            for (int i = 0; i + 1 < stmts.size(); i++) {
                Statement s = stmts.get(i);
                if (!(s.isReturnStmt() || s.isThrowStmt() || s.isBreakStmt() || s.isContinueStmt() || s.isYieldStmt())) continue;
                out.add(Issues.of(id(), "medium", "high", m, stmts.get(i + 1), "Недостижимый код после " + keyword(s),
                        "Удалить недостижимые операторы или исправить поток управления", null, null));
                break;
            }
        }
        return out;
    }

    /** В типе есть вызов или ссылка на метод с именем md вне самого md. */
    private static boolean calledIn(TypeDeclaration<?> type, MethodDeclaration md) {
        String name = md.getNameAsString();
        return !type.findAll(MethodCallExpr.class, c -> c.getNameAsString().equals(name) && !md.isAncestorOf(c)).isEmpty()
                || !type.findAll(MethodReferenceExpr.class, r -> r.getIdentifier().equals(name) && !md.isAncestorOf(r)).isEmpty();
    }

    /** Объявление локальной переменной оператором (не for/for-each/try-ресурс/catch) прямо в этом методе. */
    private static boolean isLocalStatement(VariableDeclarator v, CallableDeclaration<?> decl) {
        return v.getParentNode().filter(p -> p instanceof VariableDeclarationExpr)
                .flatMap(Node::getParentNode).filter(p -> p instanceof ExpressionStmt).isPresent()
                && v.findAncestor(CallableDeclaration.class).orElse(null) == decl;
    }

    private static TypeDeclaration<?> topLevel(TypeDeclaration<?> t) {
        TypeDeclaration<?> top = t;
        for (Node n = t; n != null; n = n.getParentNode().orElse(null)) if (n instanceof TypeDeclaration<?> td) top = td;
        return top;
    }

    private static String keyword(Statement s) {
        return s.isReturnStmt() ? "return" : s.isThrowStmt() ? "throw" : s.isBreakStmt() ? "break" : s.isContinueStmt() ? "continue" : "yield";
    }
}
