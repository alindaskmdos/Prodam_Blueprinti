plugins {
    id("blueprints.java-conventions")
    alias(libs.plugins.spring.boot)
}

dependencies {
    implementation(platform(libs.spring.boot.bom))
    implementation(libs.spring.boot.starter.web)
    testImplementation(libs.spring.boot.starter.test)
    listOf("model", "source", "blocks", "analysis", "runner", "testing", "fixes", "benchmark")
        .forEach { implementation(project(":$it")) }
}
