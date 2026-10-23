package blueprints.source;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.github.javaparser.StaticJavaParser;
import org.junit.jupiter.api.Test;

class JavaParserSmokeTest {
    @Test
    void parsesJava21() {
        var cu = StaticJavaParser.parse("class A { void f() {} }");
        assertEquals(1, cu.findAll(com.github.javaparser.ast.body.MethodDeclaration.class).size());
    }
}
