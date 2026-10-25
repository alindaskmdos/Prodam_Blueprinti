plugins { id("blueprints.java-conventions") }

dependencies {
    implementation(project(":model"))
    implementation(project(":source"))
    implementation(project(":fixes"))
    implementation(libs.jackson.databind)
}
