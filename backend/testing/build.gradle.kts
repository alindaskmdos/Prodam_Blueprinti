plugins { id("blueprints.java-conventions") }

dependencies {
    implementation(project(":model"))
    implementation(project(":runner"))
    implementation(libs.jackson.databind)
}
