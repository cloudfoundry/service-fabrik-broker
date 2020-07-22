@Library(['piper-lib', 'piper-lib-os']) _

node {
    stage('Test') {
        deleteDir()
        git url: 'https://github.com/vinaybheri/service-fabrik-broker', branch: 'master', credentialsId: 'GithubOsCredentialsId'
        setupPipelineEnvironment script: this
        kanikoExecute(script: this, dockerConfigJsonCredentialsId: 'K8sDockerId', containerImage: 'k8s-backing-services.docker.repositories.sap.ondemand.com/servicefabrikjenkins/service-fabrik-broker:kaniko', dockerfilePath: 'broker/Dockerfile')
        kanikoExecute(script: this, dockerConfigJsonCredentialsId: 'K8sDockerId', containerImage: 'k8s-backing-services.docker.repositories.sap.ondemand.com/servicefabrikjenkins/service-fabrik-interoperator:kaniko', dockerfilePath: 'interoperator/Dockerfile')


   }
   stage('Scan') {

   }
}
