@Library(['piper-lib', 'piper-lib-os']) _

pipeline {
    environment {
        imageTag = "kaniko"
        WHITESOURCE_ORG_TOKEN = credentials('whitesource_org_token')
    }
    agent any
    stages {
        stage('Setup') {
            steps {
                echo "[INFO] : imageTag: ${imageTag}"
                echo "[INFO] : WHITESOURCE_ORG_TOKEN: ${WHITESOURCE_ORG_TOKEN}"
                deleteDir()
                git url: 'https://github.com/vinaybheri/service-fabrik-broker', branch: 'master', credentialsId: 'GithubOsCredentialsId'
                setupPipelineEnvironment script: this
            }
        }
        /*stage('DockerBuild') {
            parallel {
                stage('Build Broker Image') {
                    steps {
                        kanikoExecute(script: this,
                            dockerConfigJsonCredentialsId: 'K8sbksrvdockerConfigJsonCredentialsId',
                            containerImage: "${ARTIFACT_DOCKER_HOST_URL}/servicefabrikjenkins/service-fabrik-broker:${imageTag}",
                            dockerfilePath: 'broker/Dockerfile',
                            customTlsCertificateLinks: ["${CUSTOM_TLS_CERT_1}", "${CUSTOM_TLS_CERT_2}"])
                        kanikoExecute(script: this,
                            dockerConfigJsonCredentialsId: 'DockerHubCredentialsId',
                            containerImage: "docker.io/servicefabrikjenkins/service-fabrik-broker:${imageTag}",
                            dockerfilePath: 'broker/Dockerfile')
                    }
                }
                stage('Build Interoperator Image') {
                    steps {
                        kanikoExecute(script: this,
                            dockerConfigJsonCredentialsId: 'K8sbksrvdockerConfigJsonCredentialsId',
                            containerImage: "${ARTIFACT_DOCKER_HOST_URL}/servicefabrikjenkins/service-fabrik-interoperator:${imageTag}",
                            dockerfilePath: 'interoperator/Dockerfile',
                            customTlsCertificateLinks: ["${CUSTOM_TLS_CERT_1}", "${CUSTOM_TLS_CERT_2}"])
                        kanikoExecute(script: this,
                            dockerConfigJsonCredentialsId: 'DockerHubCredentialsId',
                            containerImage: "docker.io/servicefabrikjenkins/service-fabrik-interoperator:${imageTag}",
                            dockerfilePath: 'interoperator/Dockerfile')
                    }
                }
            }
        }*/

        stage('Security scans') {
            parallel {
                /*stage('ProtecodeScan - Broker') {
                    steps {
                        protecodeExecuteScan(script: this,
                            protecodeCredentialsId: 'protecodeCredentialsId',
                            protecodeGroup: '1168',
                            protecodeServerUrl: "${PROTECODE_SERVER_URL}",
                            dockerRegistryUrl: "https://${ARTIFACT_DOCKER_HOST_URL}",
                            dockerImage: "servicefabrikjenkins/service-fabrik-broker:${imageTag}",
                            dockerCredentialsId: 'K8sbksrvdockerConfigJsonCredentialsId',
                            reportFileName: 'protecode_report_broker.pdf')
                    }
                }
                stage('ProtecodeScan - Interoperator') {
                    steps {
                        protecodeExecuteScan(script: this,
                            protecodeCredentialsId: 'protecodeCredentialsId',
                            protecodeGroup: '1168',
                            protecodeServerUrl: "${PROTECODE_SERVER_URL}",
                            dockerRegistryUrl: "https://${ARTIFACT_DOCKER_HOST_URL}",
                            dockerImage: "servicefabrikjenkins/service-fabrik-interoperator:${imageTag}",
                            dockerCredentialsId: 'K8sbksrvdockerConfigJsonCredentialsId',
                            reportFileName: 'protecode_report_interoperator.pdf')
                    }
                }*/

                stage('WhitesourceScan - Broker') {
                    steps {
                        whitesourceExecuteScan(script: this,
                            scanType: 'npm',
                            productName: 'SHC - SF-INTEROPERATOR-TEST',
                            projectNames: 'Broker',
                            verbose: true,
                            userTokenCredentialsId: 'interoperator_whitesource_test_id',
                            //orgAdminUserTokenCredentialsId: 'orgAdminToken',
                            buildDescriptorFile: './broker/applications/osb-broker/package.json',
                            orgToken: "${WHITESOURCE_ORG_TOKEN}")
                    }
                }
                /*stage('WhitesourceScan - Interoperator') {
                    steps {
                        whitesourceExecuteScan(script: this,
                            scanType: 'golang',
                            productName: 'SHC - SF-INTEROPERATOR-TEST',
                            projectNames: 'Interoperator',
                            userTokenCredentialsId: 'interoperator_whitesource_test_id',
                            configFilePath: './interoperator/wss-unified-agent.config',
                            //orgAdminUserTokenCredentialsId: 'orgAdminToken',
                            //buildDescriptorFile: './interoperator/go.mod' ,
                            securityVulnerabilities: false,
                            verbose: true,
                            orgToken: "${WHITESOURCE_ORG_TOKEN}")
                    }
                }*/
            }
        }
    }
}
