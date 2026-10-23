plugins { id("blueprints.java-conventions") }

dependencies {
    implementation(project(":model"))
    api(libs.javaparser.symbol.solver)
}
