@Library(['piper-lib', 'piper-lib-os']) _

node {
    stage('Test') {
        deleteDir()
        git url: 'https://github.com/vinaybheri/service-fabrik-broker', branch: 'master', credentialsId: 'GithubOsCredentialsId'
        setupPipelineEnvironment script: this
        kanikoExecute script: this
        mailSendNotification script: this


   }
   stage('Scan') {

   }
}
