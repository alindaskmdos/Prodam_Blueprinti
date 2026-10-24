plugins { id("blueprints.java-conventions") }

dependencies {
    implementation(project(":model"))
    implementation(project(":source"))
    implementation(libs.pmd.java)
}
