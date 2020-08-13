@Library(['piper-lib', 'piper-lib-os']) _

pipeline {
    environment {
        WHITESOURCE_ORG_TOKEN = credentials('whitesource_org_token')
        GITHUB_OS_TOKEN = credentials('GithubOsToken')
        GITHUB_SF_CREDENTIALS_TOKEN = credentials('GithubSfCredentialsTokenId')
        ENV_IMAGE_TAG = "${env.IMAGE_TAG}"
        GITHUB_OS_ORG = "cloudfoundry-incubator"
        GIT_URL_SF_CREDENTIALS = "https://${GITHUB_SF_CREDENTIALS_TOKEN}@${GITHUB_SF_CREDENTIALS_HOST}/servicefabrik/credentials.git"
        GIT_URL_SF_BROKER = "https://${GITHUB_OS_TOKEN}@github.com/${GITHUB_OS_ORG}/service-fabrik-broker.git"
        DEV_BRANCH_DOCKER = "dev_pr_${BUILD_NUMBER}"
        DEV_BRANCH_GH_PAGES = "dev_pr_ghpages_${BUILD_NUMBER}"
        HELM_VERSION = "v3.2.4"
    }
    agent any
    parameters {
        string(defaultValue: 'test', description: 'Enter Docker image tag version', name: 'IMAGE_TAG')
        booleanParam(defaultValue: false, description: 'Enable for final release', name: 'RELEASE')
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
                sh 'printenv'
            }
        }// End Stage: Setup
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
        } //End Stage: DockerBuild
        
        stage('Whitesource scan') {
            parallel {
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
        }//End Stage: Whitesource Scan

        stage('Protecode Scan') {
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
            }
        }//End Stage: Protecode Scan
        
        stage('Release') {
            when {
                environment name: 'RELEASE', value: 'true'
            }
            stages {
                stage('Release - Update Version') {
                    steps {
                        script {
                            def data = readYaml file: 'helm-charts/interoperator/Chart.yaml'
                            sh """sed -i 's/${data.appVersion}/${ENV_IMAGE_TAG}/g' helm-charts/interoperator/Chart.yaml"""
                            sh """sed -i 's/${data.appVersion}/${ENV_IMAGE_TAG}/g' helm-charts/interoperator/values.yaml"""
                            sh '''
                            git checkout -b "${DEV_BRANCH_DOCKER}"
                            git diff
                            git add helm-charts/interoperator/Chart.yaml
                            git add helm-charts/interoperator/values.yaml
                            git commit -m "Updating broker/Interoperator docker image versions:$ENV_IMAGE_TAG"
                            git push "${GIT_URL_SF_BROKER}" "${DEV_BRANCH_DOCKER}"            
                            pull_request_data="$(cat << EOF
{
  "title": "Updating broker/Interoperator docker image versions:$ENV_IMAGE_TAG",
  "base": "$GIT_BRANCH",
  "head": "${GITHUB_OS_ORG}:${DEV_BRANCH_DOCKER}",
  "body": "Updating broker/Interoperator docker image versions:$ENV_IMAGE_TAG"
}
EOF
)"
                            curl -H "Authorization: token ${GITHUB_OS_TOKEN}" -X POST -d "${pull_request_data}" "https://api.github.com/repos/${GITHUB_OS_ORG}/service-fabrik-broker/pulls"
                        '''
                        }
                    }
                } //End Stage: Release - Update Version
                
                stage('Release - Add Helm Chart') {
                    steps {
                        script {
                            sh '''
                            echo "Installing Helm :$HELM_VERSION"
                            os_arch="linux"
                            curl --silent -LO "https://get.helm.sh/helm-${HELM_VERSION}-${os_arch}-amd64.tar.gz"
                            tar -zxf "helm-${HELM_VERSION}-${os_arch}-amd64.tar.gz"
                            PATH="$PATH:$PWD/${os_arch}-amd64"
                            export PATH
                    
                            helm version
                    
                            echo "Creating Helm Package"
                            cd helm-charts/interoperator
                            helm package . || true
                            ls -l
                            echo "helm package created"
                            cd $WORKSPACE
                            
                            rm -rf gh-pages
                            git clone "${GIT_URL_SF_BROKER}" -b "gh-pages" "gh-pages"
                            echo "copying Helm package"
                            cp helm-charts/interoperator/interoperator-${ENV_IMAGE_TAG}.tgz gh-pages/helm-charts/
                            echo "copying Done"
                            helm repo index --url https://cloudfoundry-incubator.github.io/service-fabrik-broker/helm-charts "gh-pages/helm-charts/"
                            cd gh-pages
                            git diff
                            git checkout -b "${DEV_BRANCH_GH_PAGES}"
                            git add helm-charts
                            git commit -m "Adding Helm Chart Package: interoperator-${ENV_IMAGE_TAG}.tgz"
                            git push "${GIT_URL_SF_BROKER}" "${DEV_BRANCH_GH_PAGES}"
                    
                            pull_request_data="$(cat << EOF
{
  "title": "Adding Helm Chart Package: ${ENV_IMAGE_TAG}",
  "base": "gh-pages",
  "head": "${GITHUB_OS_ORG}:${DEV_BRANCH_GH_PAGES}",
  "body": "Adding Helm Chart Package: ${ENV_IMAGE_TAG}"
}
EOF
)"
                            curl -H "Authorization: token ${GITHUB_OS_TOKEN}" -X POST -d "${pull_request_data}" "https://api.github.com/repos/${GITHUB_OS_ORG}/service-fabrik-broker/pulls"
                            cd "$WORKSPACE"
                            '''     
                        } 
                    } 
                }// End Stage: Release - Add Helm Chart
                
                stage ('Release - Confirm') {
                    input{ 
                        message "Review the PR's created in previous stages.Proceed to continue after merging the PR's."  
                    }
                    steps {
                        echo """
                            Proceeding to create release tag and attach release note template.
                        """
                    }
                } //End Stage: Release - Confirm
                
                stage ('Release - Create Tag And Notes') {
                    steps {
                        script {
                            sh '''#!/bin/bash
                            if git tag -l | grep "$ENV_IMAGE_TAG" 
                            then
                                git push --delete ${GIT_URL_SF_BROKER} "$ENV_IMAGE_TAG"
                                git tag -d "$ENV_IMAGE_TAG" 
                            fi
                            
                            echo "Installing kubectl & jq"
                            kubectl_version=$(curl --silent https://storage.googleapis.com/kubernetes-release/release/stable.txt)
                            curl --silent -LO "https://storage.googleapis.com/kubernetes-release/release/${kubectl_version}/bin/linux/amd64/kubectl"
                            chmod +x ./kubectl
                            mkdir bin
                            export PATH="$PATH:$PWD/bin"
                            mv ./kubectl bin/
                            curl https://stedolan.github.io/jq/download/linux64/jq --output bin/jq
                            chmod +x bin/jq
                            echo "Installed kubectl & jq"
                            
                            echo "INFO: Fetching 3 latest k8s versions supported..."
                            git clone "${GIT_URL_SF_CREDENTIALS}" "sfcredentials"
                            export KUBECONFIG="$WORKSPACE/sfcredentials/k8s/n/kubeconfig.yaml"
                            K8S_VERSION_N=$(kubectl version -o json | jq -r '.serverVersion.gitVersion')
                            export KUBECONFIG="$WORKSPACE/sfcredentials/k8s/n-1/kubeconfig.yaml"
                            K8S_VERSION_N_1=$(kubectl version -o json | jq -r '.serverVersion.gitVersion')
                            export KUBECONFIG="$WORKSPACE/sfcredentials/k8s/n-2/kubeconfig.yaml"
                            K8S_VERSION_N_2=$(kubectl version -o json | jq -r '.serverVersion.gitVersion')
                        
                            echo "INFO: Getting list of commits from last release/tag"
                            last_tag_version="$(git tag | grep -E "[0-9]+.[0-9]+.[0-9]+" | grep -v "$ENV_IMAGE_TAG" | tail -1)"
                            commit_list="$(git log --pretty=format:"%h: %s\\n" HEAD...${last_tag_version})"
                            
                            echo "INFO: Generating Release notes"
                            echo """## New features/Bug fixes\\n
${commit_list}\\n
\\n
## Supported K8S Version\\n
- $(echo "${K8S_VERSION_N_2}" | awk -F "." '{print $1"."$2".x"}')\\n
- $(echo "${K8S_VERSION_N_1}" | awk -F "." '{print $1"."$2".x"}')\\n
- $(echo "${K8S_VERSION_N}" | awk -F "." '{print $1"."$2".x"}')\\n
## How to deploy Interoperator\\n
Interoperator requires **helm version >= 3.0.0**, and is **not supported by helm 2**.\\n
\\n
To add service fabrik interoperator helm chart repo\\n
\\`\\`\\`shell\\n
helm repo add interoperator-charts https://cloudfoundry-incubator.github.io/service-fabrik-broker/helm-charts\\n
helm repo update\\n
\\`\\`\\`\\n
\\n
Deploy SF Interoperator using helm\\n
\\`\\`\\`shell\\n
helm install --set cluster.host=sf.ingress.< clusterdomain > --namespace interoperator --version ${ENV_IMAGE_TAG} interoperator interoperator-charts/interoperator\\n
\\`\\`\\`\\n
**NOTE:** \\`cluster.host\\` should be within the [63 character limit](http://man7.org/linux/man-pages/man7/hostname.7.html).\\n
### Deploy SFClusters, SFServices and SFPlans and Register with Interoperator\\n
Please create sfcluster CRs and add reference to secret which contains the its kubeconfig.\\n
For multi-cluster support, all corresponding sfcluster CRs need to be created and their kubeconfig needs to be supplied in the corresponding secret.\\n
Please note that sfcluster, sfservice and sfplans need to be deployed in the same namespace where SF is deployed (default is \\`interoperator\\`).\\n
## Upgrade from the earlier releases(special handling, downtime if any)\\n
\\n
To add service fabrik interoperator helm chart repo if not already added\\n
\\`\\`\\`shell\\n
# Assuming the repo name is chosen as interoperator-charts \\n
helm repo add interoperator-charts https://cloudfoundry-incubator.github.io/service-fabrik-broker/helm-charts\\n
helm repo update\\n
\\`\\`\\`\\n
Helm upgrade should take care of upgrading to the latest release.\\n
\\`\\`\\`shell\\n
# Assuming current helm release name is interoperator\\n
helm --namespace interoperator upgrade -i --wait --set cluster.host=sf.ingress.< clusterdomain > --version ${ENV_IMAGE_TAG} interoperator interoperator-charts/interoperator\\n
\\`\\`\\`\\n
Refer detailed [upgrade docs](docs/interoperator-upgrades.md) for more info.\\n
\\n
\\n
""" > .release_notes
                            text=$(cat .release_notes| tr -d '\n' | tr -d '"' )
generate_post_data()
{
cat <<EOF
{
  "tag_name": "${ENV_IMAGE_TAG}",
  "target_commitish": "$GIT_BRANCH",
  "name": "Interoperator Release ${ENV_IMAGE_TAG}",
  "body": "$text",
  "draft": false,
  "prerelease": false
}
EOF
}
                            repo_full_name="${GITHUB_OS_ORG}/service-fabrik-broker"
                            echo "Create release $ENV_IMAGE_TAG for $repo_full_name :  branch: $GIT_BRANCH"
                            curl --data "$(generate_post_data)" "https://api.github.com/repos/$repo_full_name/releases?access_token=$GITHUB_OS_TOKEN"
                            '''
                        }
                    }
                } // End Stage: Release - Create Tag And Notes
                
            } // End Stages
        } //End Stage: Release
    }
}
