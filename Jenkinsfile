@Library(['piper-lib', 'piper-lib-os']) _

pipeline {
    environment {
        WHITESOURCE_ORG_TOKEN = credentials('whitesource_org_token')
    }
    agent any
    parameters {
        string(defaultValue: 'test', description: 'Enter Docker image tag version', name: 'IMAGE_TAG')
    }
    stages {
        stage('Setup') {
            steps {
                deleteDir()
                git url: 'https://github.com/cloudfoundry-incubator/service-fabrik-broker', branch: 'master', credentialsId: 'GithubOsCredentialsId'
                setupPipelineEnvironment script: this
                sh 'rm -rf broker/applications/admin'
                sh 'rm -rf broker/applications/deployment_hooks'
                sh 'rm -rf broker/applications/extensions'
                sh 'rm -rf broker/applications/operators'
                sh 'rm -rf broker/applications/reports'
                sh 'rm -rf broker/applications/scheduler'
                sh 'rm -rf broker/test'
                sh 'rm -rf webhooks'
            }
        }
        stage('DockerBuild') {
            parallel {
                stage('Build Broker Image') {
                    steps {
                        kanikoExecute(script: this,
                            dockerConfigJsonCredentialsId: 'InteroperatorDockerAuthConfigJson',
                            containerImage: "${ARTIFACT_DOCKER_HOST_URL}/images/service-fabrik-broker:${env.IMAGE_TAG}",
                            dockerfilePath: 'broker/Dockerfile',
                            customTlsCertificateLinks: ["${CUSTOM_TLS_CERT_1}", "${CUSTOM_TLS_CERT_2}"])
                        kanikoExecute(script: this,
                            dockerConfigJsonCredentialsId: 'DockerHubCredentialsId',
                            containerImage: "docker.io/servicefabrikjenkins/service-fabrik-broker:${env.IMAGE_TAG}",
                            dockerfilePath: 'broker/Dockerfile')
                    }
                }
                stage('Build Interoperator Image') {
                    steps {
                        kanikoExecute(script: this,
                            dockerConfigJsonCredentialsId: 'InteroperatorDockerAuthConfigJson',
                            containerImage: "${ARTIFACT_DOCKER_HOST_URL}/images/service-fabrik-interoperator:${env.IMAGE_TAG}",
                            dockerfilePath: 'interoperator/Dockerfile',
                            customTlsCertificateLinks: ["${CUSTOM_TLS_CERT_1}", "${CUSTOM_TLS_CERT_2}"])
                        kanikoExecute(script: this,
                            dockerConfigJsonCredentialsId: 'DockerHubCredentialsId',
                            containerImage: "docker.io/servicefabrikjenkins/service-fabrik-interoperator:${env.IMAGE_TAG}",
                            dockerfilePath: 'interoperator/Dockerfile')
                    }
                }
            }
        }

        stage('Security scans') {
            parallel {
                stage('ProtecodeScan - Broker') {
                    steps {
                        protecodeExecuteScan(script: this,
                            protecodeCredentialsId: 'protecodeCredentialsId',
                            protecodeGroup: "${INTOPERATOR_PROTECODE_GROUP_ID}",
                            protecodeServerUrl: "${PROTECODE_SERVER_URL}",
                            dockerRegistryUrl: "https://${ARTIFACT_DOCKER_HOST_URL}",
                            dockerImage: "images/service-fabrik-broker:${env.IMAGE_TAG}",
                            dockerCredentialsId: 'InteroperatorDockerAuthConfigJson',
                            reportFileName: 'protecode_report_broker.pdf')
                    }
                }
                stage('ProtecodeScan - Interoperator') {
                    steps {
                        protecodeExecuteScan(script: this,
                            protecodeCredentialsId: 'protecodeCredentialsId',
                            protecodeGroup: "${INTOPERATOR_PROTECODE_GROUP_ID}",
                            protecodeServerUrl: "${PROTECODE_SERVER_URL}",
                            dockerRegistryUrl: "https://${ARTIFACT_DOCKER_HOST_URL}",
                            dockerImage: "images/service-fabrik-interoperator:${env.IMAGE_TAG}",
                            dockerCredentialsId: 'InteroperatorDockerAuthConfigJson',
                            reportFileName: 'protecode_report_interoperator.pdf')
                    }
                }

                stage('WhitesourceScan - Broker') {
                    steps {
                        sh 'rm -rfv broker/package.json'
                        whitesourceExecuteScan(script: this,
                            scanType: 'npm',
                            productName: "${WSS_PROD_NAME}",
                            userTokenCredentialsId: 'interoperator_whitesource_test_id',
                            configFilePath: './wss-unified-agent.config',
                            buildDescriptorFile: './broker/applications/osb-broker/package.json',
                            securityVulnerabilities: false,
                            orgToken: "${WHITESOURCE_ORG_TOKEN}")
                    }
                }
                stage('WhitesourceScan - Interoperator') {
                    steps {
                        whitesourceExecuteScan(script: this,
                            scanType: 'golang',
                            productName: "${WSS_PROD_NAME}",
                            userTokenCredentialsId: 'interoperator_whitesource_test_id',
                            configFilePath: './wss-unified-agent.config',
                            buildDescriptorFile: './interoperator/go.mod',
                            securityVulnerabilities: false,
                            orgToken: "${WHITESOURCE_ORG_TOKEN}")
                    }
                }
            }
        }
    }
}
