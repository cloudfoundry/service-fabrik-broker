@Library(['piper-lib', 'piper-lib-os']) _

node {
    stage('DockerBuild') {
        deleteDir()
        git url: 'https://github.com/vinaybheri/service-fabrik-broker', branch: 'master', credentialsId: 'GithubOsCredentialsId'
        setupPipelineEnvironment script: this
        //kanikoExecute(script: this, dockerConfigJsonCredentialsId: 'K8sbksrvdockerConfigJsonCredentialsId', containerImage: 'k8s-backing-services.docker.repositories.sap.ondemand.com/servicefabrikjenkins/service-fabrik-broker:kaniko', dockerfilePath: 'broker/Dockerfile', customTlsCertificateLinks: ["http://aia.pki.co.sap.com/aia/SAPNetCA_G2.crt", "http://aia.pki.co.sap.com/aia/SAP%20Global%20Root%20CA.crt"])
        //kanikoExecute(script: this, dockerConfigJsonCredentialsId: 'K8sbksrvdockerConfigJsonCredentialsId', containerImage: 'k8s-backing-services.docker.repositories.sap.ondemand.com/servicefabrikjenkins/service-fabrik-interoperator:kaniko', dockerfilePath: 'interoperator/Dockerfile', customTlsCertificateLinks: ["http://aia.pki.co.sap.com/aia/SAPNetCA_G2.crt", "http://aia.pki.co.sap.com/aia/SAP%20Global%20Root%20CA.crt"])
        //kanikoExecute(script: this, dockerConfigJsonCredentialsId: 'DockerHubCredentialsId', containerImage: 'docker.io/servicefabrikjenkins/service-fabrik-broker:kaniko', dockerfilePath: 'broker/Dockerfile')
        //kanikoExecute(script: this, dockerConfigJsonCredentialsId: 'DockerHubCredentialsId', containerImage: 'docker.io/servicefabrikjenkins/service-fabrik-interoperator:kaniko', dockerfilePath: 'interoperator/Dockerfile')

   }
   stage('ProtecodeScan') {
       protecodeExecuteScan(script: this,
                            protecodeCredentialsId: 'protecodeCredentialsId',
                            protecodeGroup: '1168',
                            protecodeServerUrl: 'https://protecode.c.eu-de-2.cloud.sap',
                            dockerRegistryUrl: 'https://k8s-backing-services.docker.repositories.sap.ondemand.com',
                            dockerImage: 'servicefabrikjenkins/service-fabrik-broker:kaniko',
                            dockerCredentialsId: 'K8sbksrvdockerConfigJsonCredentialsId',
                            reportFileName: 'protecode_report_broker.pdf')
                            
                            
                         
   }
}
