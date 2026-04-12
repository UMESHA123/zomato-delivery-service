pipeline {
    agent {
        label 'docker'
    }

    tools {
        nodejs 'node-22'  // Configure in Jenkins Global Tool Configuration
    }

    environment {
        SERVICE_NAME    = 'delivery-service'
        REPO_NAME       = 'zomato-delivery-service'
        DOCKER_REGISTRY = 'docker.io/umesa123'
        DOCKER_CREDS    = 'docker-registry-credentials'
        IMAGE_TAG       = "${env.BUILD_NUMBER}-${env.GIT_COMMIT.take(7)}"
        DOCKER_BUILDKIT = '1'
        npm_config_cache = "${WORKSPACE}/.npm-cache"
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '5'))
        timeout(time: 20, unit: 'MINUTES')
        timestamps()
        disableConcurrentBuilds(abortPrevious: true)
        skipStagesAfterUnstable()
    }

    triggers {
        githubPush()
    }

    stages {

        // ==================== CHECKOUT ====================
        stage('Checkout') {
            steps {
                checkout scm
                script {
                    env.GIT_AUTHOR    = sh(script: "git log -1 --pretty=format:'%an'", returnStdout: true).trim()
                    env.GIT_MSG       = sh(script: "git log -1 --pretty=format:'%s'",  returnStdout: true).trim()
                    env.GIT_SHORT     = env.GIT_COMMIT.take(7)
                    env.IS_MAIN       = (env.BRANCH_NAME == 'main') ? 'true' : 'false'
                    env.IS_PR         = (env.CHANGE_ID != null) ? 'true' : 'false'
                    env.FULL_IMAGE    = "${DOCKER_REGISTRY}/zomato-${SERVICE_NAME}"
                }
            }
        }

        // ==================== INSTALL ====================
        stage('Install') {
            steps {
                sh 'npm ci --prefer-offline'
            }
        }

        // ==================== PARALLEL: LINT + AUDIT ====================
        stage('Quality Checks') {
            parallel {
                stage('Lint') {
                    steps {
                        script {
                            def hasLint = sh(script: 'node -e "const p=require(\'./package.json\'); process.exit(p.scripts && p.scripts.lint ? 0 : 1)"', returnStatus: true) == 0
                            if (hasLint) {
                                sh 'npm run lint'
                            } else {
                                echo "No lint script in package.json. Skipping."
                            }
                        }
                    }
                }
                stage('Dependency Audit') {
                    steps {
                        // Audit for high/critical vulnerabilities in npm packages
                        sh 'npm audit --audit-level=critical || true'
                        // Generate audit report
                        sh 'npm audit --json > npm-audit-report.json 2>/dev/null || true'
                        archiveArtifacts artifacts: 'npm-audit-report.json', allowEmptyArchive: true
                    }
                }
            }
        }

        // ==================== UNIT TESTS ====================
        stage('Unit Tests') {
            steps {
                script {
                    def hasTest = sh(script: 'node -e "const p=require(\'./package.json\'); process.exit(p.scripts && p.scripts.test ? 0 : 1)"', returnStatus: true) == 0
                    if (hasTest) {
                        // Try with coverage first, fallback to plain test
                        def hasCoverage = sh(script: 'node -e "const p=require(\'./package.json\'); process.exit(p.scripts && p.scripts[\'test:coverage\'] ? 0 : 1)"', returnStatus: true) == 0
                        if (hasCoverage) {
                            sh 'npm run test:coverage'
                        } else {
                            sh 'npm test'
                        }
                    } else {
                        echo "No test script in package.json. Skipping."
                    }
                }
            }
            post {
                always {
                    // Publish test results if available
                    junit testResults: '**/junit*.xml', allowEmptyResults: true
                    // Publish coverage if available (Cobertura format)
                    cobertura(
                        coberturaReportFile: '**/coverage/cobertura-coverage.xml',
                        failNoReports: false
                    )
                }
            }
        }

        // ==================== BUILD ====================
        stage('Build') {
            steps {
                sh 'npm run build'
            }
        }

        // ==================== DOCKER BUILD ====================
        stage('Docker Build') {
            steps {
                sh """
                    docker build \
                        --label org.opencontainers.image.created=\$(date -u +'%Y-%m-%dT%H:%M:%SZ') \
                        --label org.opencontainers.image.version=${IMAGE_TAG} \
                        --label org.opencontainers.image.revision=${env.GIT_COMMIT} \
                        --label org.opencontainers.image.source=https://github.com/UMESHA123/${REPO_NAME} \
                        --label org.opencontainers.image.title=zomato-${SERVICE_NAME} \
                        --cache-from ${FULL_IMAGE}:latest \
                        -t ${FULL_IMAGE}:${IMAGE_TAG} \
                        -t ${FULL_IMAGE}:latest \
                        .
                """
            }
        }

        // ==================== SECURITY SCAN ====================
        stage('Security Scan') {
            steps {
                script {
                    def trivyInstalled = sh(script: 'which trivy', returnStatus: true) == 0
                    if (trivyInstalled) {
                        sh """
                            trivy image \
                                --severity HIGH,CRITICAL \
                                --format json \
                                --output trivy-report.json \
                                ${FULL_IMAGE}:${IMAGE_TAG}
                        """
                        archiveArtifacts artifacts: 'trivy-report.json', allowEmptyArchive: true

                        // Fail on CRITICAL vulnerabilities
                        sh """
                            trivy image \
                                --severity CRITICAL \
                                --exit-code 1 \
                                --format table \
                                ${FULL_IMAGE}:${IMAGE_TAG}
                        """
                    } else {
                        echo "WARNING: Trivy not installed. Skipping security scan."
                    }
                }
            }
        }

        // ==================== PUSH IMAGE ====================
        stage('Push Image') {
            when {
                anyOf {
                    branch 'main'
                    branch 'develop'
                }
            }
            steps {
                retry(3) {
                    withDockerRegistry(credentialsId: DOCKER_CREDS, url: 'https://index.docker.io/v1/') {
                        sh "docker push ${FULL_IMAGE}:${IMAGE_TAG}"
                        sh "docker push ${FULL_IMAGE}:latest"
                    }
                }
            }
        }

        // ==================== DEPLOY TO STAGING ====================
        stage('Deploy to Staging') {
            when {
                branch 'main'
            }
            steps {
                script {
                    echo "Deploying ${SERVICE_NAME}:${IMAGE_TAG} to STAGING..."

                    // Uncomment your deployment method:
                    /*
                    sshagent(['staging-ssh-key']) {
                        sh """
                            ssh -o StrictHostKeyChecking=no deployer@\${STAGING_SERVER} \\
                                'cd /opt/zomato && \\
                                 ./deploy.sh ${SERVICE_NAME} ${IMAGE_TAG}'
                        """
                    }
                    */

                    echo ">>> Configure your staging deployment method above <<<"
                }
            }
        }

        // ==================== SMOKE TESTS ====================
        stage('Smoke Tests') {
            when {
                branch 'main'
            }
            steps {
                script {
                    echo "Running smoke tests against staging..."

                    /*
                    retry(5) {
                        sleep(time: 10, unit: 'SECONDS')
                        sh """
                            HTTP_CODE=\$(curl -s -o /dev/null -w '%{http_code}' \
                                --max-time 10 \
                                http://\${STAGING_SERVER}:PORT/health)
                            if [ "\$HTTP_CODE" != "200" ]; then
                                echo "Health check returned \$HTTP_CODE"
                                exit 1
                            fi
                            echo "Health check passed (HTTP \$HTTP_CODE)"
                        """
                    }
                    */

                    echo ">>> Configure smoke tests for your staging URL <<<"
                }
            }
        }

        // ==================== DEPLOY TO PRODUCTION ====================
        stage('Deploy to Production') {
            when {
                branch 'main'
            }
            steps {
                timeout(time: 1, unit: 'HOURS') {
                    input message: "Deploy ${SERVICE_NAME}:${IMAGE_TAG} to PRODUCTION?",
                          ok: 'Approve & Deploy',
                          submitter: 'admin,deployer',
                          parameters: [
                              string(name: 'APPROVER_NOTE', defaultValue: '', description: 'Optional: reason for approval')
                          ]
                }

                script {
                    echo "Deploying ${SERVICE_NAME}:${IMAGE_TAG} to PRODUCTION..."

                    /*
                    sshagent(['production-ssh-key']) {
                        sh """
                            ssh -o StrictHostKeyChecking=no deployer@\${PROD_SERVER} \\
                                'cd /opt/zomato && \\
                                 ./deploy.sh ${SERVICE_NAME} ${IMAGE_TAG}'
                        """
                    }
                    */

                    echo ">>> Configure your production deployment method above <<<"
                }
            }
        }

        // ==================== TAG RELEASE ====================
        stage('Tag Release') {
            when {
                branch 'main'
            }
            steps {
                sh """
                    git tag -a "v${IMAGE_TAG}" -m "Production release ${IMAGE_TAG} for ${SERVICE_NAME}"
                    git push origin "v${IMAGE_TAG}" || true
                """
            }
        }
    }

    post {
        always {
            sh "docker rmi ${FULL_IMAGE}:${IMAGE_TAG} || true"
            sh "docker rmi ${FULL_IMAGE}:latest || true"
            cleanWs()
        }
        success {
            echo "SUCCESS: ${SERVICE_NAME}:${IMAGE_TAG} | ${env.GIT_MSG} | by ${env.GIT_AUTHOR}"
            /*
            slackSend(
                color: 'good',
                channel: '#deployments',
                message: "*${SERVICE_NAME}* `${IMAGE_TAG}` — SUCCESS\n> ${env.GIT_MSG}\n> Author: ${env.GIT_AUTHOR}\n> <${env.BUILD_URL}|View Build>"
            )
            */
        }
        failure {
            echo "FAILED: ${SERVICE_NAME}:${IMAGE_TAG} | ${env.GIT_MSG} | by ${env.GIT_AUTHOR}"
            /*
            slackSend(
                color: 'danger',
                channel: '#deployments',
                message: "*${SERVICE_NAME}* — FAILED\n> ${env.GIT_MSG}\n> Author: ${env.GIT_AUTHOR}\n> <${env.BUILD_URL}|View Build>"
            )
            */
        }
        unstable {
            echo "UNSTABLE: ${SERVICE_NAME}:${IMAGE_TAG} — tests may have failed"
        }
    }
}
