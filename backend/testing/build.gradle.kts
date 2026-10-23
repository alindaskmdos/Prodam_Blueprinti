plugins { id("blueprints.java-conventions") }

// jar JUnit console launcher: кладётся в ресурсы модуля и монтируется в контейнер read-only (в песочнице нет сети)
val junitLauncher: Configuration by configurations.creating

dependencies {
    implementation(project(":model"))
    implementation(project(":runner"))
    implementation(libs.jackson.databind)
    junitLauncher(libs.junit.platform.console.standalone)
}

tasks.processResources {
    from(junitLauncher) {
        into("blueprints/testing/junit")
        rename { "junit-platform-console-standalone.jar" }
    }
}
