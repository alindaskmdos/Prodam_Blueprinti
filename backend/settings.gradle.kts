pluginManagement {
    includeBuild("build-logic")
}

plugins {
    // скачивает JDK 21 для toolchain, если его нет локально
    id("org.gradle.toolchains.foojay-resolver-convention") version "0.8.0"
}

rootProject.name = "blueprints"

include("model", "source", "blocks", "analysis", "runner", "testing", "fixes", "benchmark", "ai", "app", "cli")
