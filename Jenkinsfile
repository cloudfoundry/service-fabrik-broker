@Library(['piper-lib', 'piper-lib-os']) _

node {
    stage('Test') {
        deleteDir()
        git url: 'https://github.com/vinaybheri/service-fabrik-broker', branch: 'master', credentialsId: 'GithubOsCredentialsId'
        setupPipelineEnvironment script: this
        kanikoExecute(script: this, dockerConfigJsonCredentialsId: 'DockerHubCredentialsId', containerImage: 'docker.io/servicefabrikjenkins/service-fabrik-broker:kaniko', dockerfilePath: 'broker/Dockerfile')
        kanikoExecute(script: this, dockerConfigJsonCredentialsId: 'DockerHubCredentialsId', containerImage: 'docker.io/servicefabrikjenkins/service-fabrik-interoperator:kaniko', dockerfilePath: 'interoperator/Dockerfile')


   }
   stage('Scan') {

   }
}
