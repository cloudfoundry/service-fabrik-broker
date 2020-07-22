@Library(['piper-lib', 'piper-lib-os']) _

node {
    def imageTag = 'kaniko'
    stage('DockerBuild') {
        deleteDir()
        git url: 'https://github.com/vinaybheri/service-fabrik-broker', branch: 'master', credentialsId: 'GithubOsCredentialsId'
        setupPipelineEnvironment script: this
        parallel {
            kanikoExecute(script: this,
                          dockerConfigJsonCredentialsId: 'K8sbksrvdockerConfigJsonCredentialsId',
                          containerImage: 'k8s-backing-services.docker.repositories.sap.ondemand.com/servicefabrikjenkins/service-fabrik-broker:${imageTag}',
                          dockerfilePath: 'broker/Dockerfile',
                          customTlsCertificateLinks: ["http://aia.pki.co.sap.com/aia/SAPNetCA_G2.crt", "http://aia.pki.co.sap.com/aia/SAP%20Global%20Root%20CA.crt"])
            kanikoExecute(script: this,
                          dockerConfigJsonCredentialsId: 'K8sbksrvdockerConfigJsonCredentialsId',
                          containerImage: 'k8s-backing-services.docker.repositories.sap.ondemand.com/servicefabrikjenkins/service-fabrik-interoperator:${imageTag}',
                          dockerfilePath: 'interoperator/Dockerfile',
                          customTlsCertificateLinks: ["http://aia.pki.co.sap.com/aia/SAPNetCA_G2.crt", "http://aia.pki.co.sap.com/aia/SAP%20Global%20Root%20CA.crt"])
            kanikoExecute(script: this,
                          dockerConfigJsonCredentialsId: 'DockerHubCredentialsId',
                          containerImage: 'docker.io/servicefabrikjenkins/service-fabrik-broker:${imageTag}',
                          dockerfilePath: 'broker/Dockerfile')
            kanikoExecute(script: this,
                          dockerConfigJsonCredentialsId: 'DockerHubCredentialsId',
                          containerImage: 'docker.io/servicefabrikjenkins/service-fabrik-interoperator:${imageTag}',
                          dockerfilePath: 'interoperator/Dockerfile')
        }
    }
    stage('ProtecodeScan') {
        parallel {
            protecodeExecuteScan(script: this,
                                 protecodeCredentialsId: 'protecodeCredentialsId',
                                 protecodeGroup: '1168',
                                 protecodeServerUrl: 'https://protecode.c.eu-de-2.cloud.sap',
                                 dockerRegistryUrl: 'https://k8s-backing-services.docker.repositories.sap.ondemand.com',
                                 dockerImage: 'servicefabrikjenkins/service-fabrik-broker:${imageTag}',
                                 dockerCredentialsId: 'K8sbksrvdockerConfigJsonCredentialsId',
                                 reportFileName: 'protecode_report_broker.pdf')
            protecodeExecuteScan(script: this,
                                 protecodeCredentialsId: 'protecodeCredentialsId',
                                 protecodeGroup: '1168',
                                 protecodeServerUrl: 'https://protecode.c.eu-de-2.cloud.sap',
                                 dockerRegistryUrl: 'https://k8s-backing-services.docker.repositories.sap.ondemand.com',
                                 dockerImage: 'servicefabrikjenkins/service-fabrik-interoperator:${imageTag}',
                                 dockerCredentialsId: 'K8sbksrvdockerConfigJsonCredentialsId',
                                 reportFileName: 'protecode_report_interoperator.pdf')
        }                   
    }
    stage('WhitesourceScan') {
       whitesourceExecuteScan(script: this,
                              scanType: 'golang',
                              productName: 'SHC - INTEROPERATOR',
                              userTokenCredentialsId: 'interoperator_whitesource_test_id',
                              orgAdminUserTokenCredentialsId: 'orgAdminToken', orgToken: '6971b2eec2d3420bad0caf173ec629f6a3c7d3ba63f3445ab99ffdbf1acfb1d0')
   }
}
