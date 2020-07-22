@Library(['piper-lib', 'piper-lib-os']) _

node {
    def imageTag = 'kaniko'
    
    stage('Setup') {
        deleteDir()
        git url: 'https://github.com/vinaybheri/service-fabrik-broker', branch: 'master', credentialsId: 'GithubOsCredentialsId'
        setupPipelineEnvironment script: this
    }
    
    stage('DockerBuild') {
        parallel {
            stage('Build Broker Image - Artifactory') {
                kanikoExecute(script: this,
                              dockerConfigJsonCredentialsId: 'K8sbksrvdockerConfigJsonCredentialsId',
                              containerImage: "k8s-backing-services.docker.repositories.sap.ondemand.com/servicefabrikjenkins/service-fabrik-broker:${imageTag}",
                              dockerfilePath: 'broker/Dockerfile',
                              customTlsCertificateLinks: ["http://aia.pki.co.sap.com/aia/SAPNetCA_G2.crt", "http://aia.pki.co.sap.com/aia/SAP%20Global%20Root%20CA.crt"])
            }
            stage('Build Interoperator Image - Artifactory') {
                kanikoExecute(script: this,
                              dockerConfigJsonCredentialsId: 'K8sbksrvdockerConfigJsonCredentialsId',
                              containerImage: "k8s-backing-services.docker.repositories.sap.ondemand.com/servicefabrikjenkins/service-fabrik-interoperator:${imageTag}",
                              dockerfilePath: 'interoperator/Dockerfile',
                              customTlsCertificateLinks: ["http://aia.pki.co.sap.com/aia/SAPNetCA_G2.crt", "http://aia.pki.co.sap.com/aia/SAP%20Global%20Root%20CA.crt"])
            }
            stage('Build Broker Image - Public') {
                kanikoExecute(script: this,
                              dockerConfigJsonCredentialsId: 'DockerHubCredentialsId',
                              containerImage: "docker.io/servicefabrikjenkins/service-fabrik-broker:${imageTag}",
                              dockerfilePath: 'broker/Dockerfile')
            }
            stage('Build Interoperator Image - Public') {
                kanikoExecute(script: this,
                              dockerConfigJsonCredentialsId: 'DockerHubCredentialsId',
                              containerImage: "docker.io/servicefabrikjenkins/service-fabrik-interoperator:${imageTag}",
                              dockerfilePath: 'interoperator/Dockerfile')
            }
        }
    }
    stage('ProtecodeScan') {
        parallel {
            stage('ProtecodeScan - Broker') {
                protecodeExecuteScan(script: this,
                    protecodeCredentialsId: 'protecodeCredentialsId',
                    protecodeGroup: '1168',
                    protecodeServerUrl: 'https://protecode.c.eu-de-2.cloud.sap',
                    dockerRegistryUrl: 'https://k8s-backing-services.docker.repositories.sap.ondemand.com',
                    dockerImage: "servicefabrikjenkins/service-fabrik-broker:${imageTag}",
                    dockerCredentialsId: 'K8sbksrvdockerConfigJsonCredentialsId',
                    reportFileName: 'protecode_report_broker.pdf')
            }
            stage('ProtecodeScan - Interoperator') {
                protecodeExecuteScan(script: this,
                    protecodeCredentialsId: 'protecodeCredentialsId',
                    protecodeGroup: '1168',
                    protecodeServerUrl: 'https://protecode.c.eu-de-2.cloud.sap',
                    dockerRegistryUrl: 'https://k8s-backing-services.docker.repositories.sap.ondemand.com',
                    dockerImage: "servicefabrikjenkins/service-fabrik-interoperator:${imageTag}",
                    dockerCredentialsId: 'K8sbksrvdockerConfigJsonCredentialsId',
                    reportFileName: 'protecode_report_interoperator.pdf')
            }
        }                   
    }
    /*stage('WhitesourceScan') {
        environment {
            WHITESOURCE_ORG_TOKEN = credentials('whitesource_org_token')
        }
        whitesourceExecuteScan(script: this,
                               scanType: 'golang',
                               productName: 'SHC - INTEROPERATOR',
                               userTokenCredentialsId: 'interoperator_whitesource_test_id',
                               //orgAdminUserTokenCredentialsId: 'orgAdminToken',
                               orgToken: "$WHITESOURCE_ORG_TOKEN")
   }*/
}
