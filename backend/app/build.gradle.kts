plugins {
    id("blueprints.java-conventions")
    alias(libs.plugins.spring.boot)
}

dependencies {
    implementation(platform(libs.spring.boot.bom))
    implementation(libs.spring.boot.starter.web)
    testImplementation(libs.spring.boot.starter.test)
    testImplementation(libs.json.schema.validator)
    listOf("model", "source", "blocks", "analysis", "runner", "testing", "fixes", "benchmark", "ai")
        .forEach { implementation(project(":$it")) }
}
