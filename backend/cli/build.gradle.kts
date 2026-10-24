plugins {
    id("blueprints.java-conventions")
    application
}

application {
    mainClass.set("blueprints.cli.Cli")
    applicationName = "blueprints"
}

dependencies {
    implementation(project(":model"))
    implementation(project(":source"))
    implementation(project(":analysis"))
    implementation(project(":testing"))
    implementation(project(":runner"))
    implementation(libs.picocli)
    implementation(libs.jackson.databind)
}
