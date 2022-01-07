# Service Fabrik Inter-operator Authentication

##  Abstract

This document describes the basic and mTLS authentication supported by the Service Fabrik inter-operator broker & cis quota check.

## Table of Content
- [Service Fabrik Inter-operator Basic Architecture](#service-fabrik-inter-operator-basic-architecture)
  - [Abstract](#abstract)
  - [Table of Content](#table-of-content)
  - [Context](#context)
  - [BasicAuthentication](#basic-authentication)
  - [mTLSAuthentication](#mtls-authentication)
    - [InteroperatorBroker](#broker)
      - [CertificateIdentityVerification](#certificate-identity-verification)
      - [XrsRegistration](#xrs-registration)
    - [CISQuotaCheck](#cis-quota-check)

## Context
The following two authentication mechanisms are supported for communicating with the brokers:
  - Basic Authentication: validates the username and password.
  - mTLS Authentication: validates the client certificate's subject pattern.

## Basic Authentication
To use Basic Authentication, the username and password should be provided during the registration of the broker.

The broker will use the credentials provided during registration to perform the authentication.

In order to use basic auth, "secureIncomingConnections" flag must be set to false.

## mTLS Authentication

### Broker
Interoperator broker currently supports mTLS authentication using Nginx ingress annotations.

Nginx ingress has been configured to support the same, by adding the following auth-tls annotations:
  - `nginx.ingress.kubernetes.io/auth-tls-verify-client: "on"`<br>
    Must be set to "on" to enable verification of client certificates. When this annotation is set to "on", it requests a client certificate that must be signed by a certificate that is included in the secret key ca.crt of the secret specified by "nginx.ingress.kubernetes.io/auth-tls-secret"
  - `nginx.ingress.kubernetes.io/auth-tls-secret: namespace/secretName`<br>
    This secret must have a file named ca.crt containing the root Certificate Authority ca.crt that is enabled to authenticate against this Ingress.
  - `nginx.ingress.kubernetes.io/auth-tls-pass-certificate-to-upstream: true`<br>
    when set to true, passes the received certificates to the upstream server in the header ssl-client-cert. For mTLS auth, this annotation must be set to true.
<br>Ref: https://kubernetes.github.io/ingress-nginx/user-guide/nginx-configuration/annotations/#client-certificate-authentication

Once the request reaches the broker server, it checks the value of "secureIncomingConnections" flag. This value must be set to true for mTLS auth to happen. Else, basic authentication will be performed.

#### Certificate Identity Verification
If the "secureIncomingConnections" flag is set to true, mTLS authentication will be performed, where the certificate identity verification will happen. The interoperator broker matches the sm_certificate_subject_pattern with the subject header received in the client certificate.
<br>The "sm_certificate_subject_pattern" value must be set to the client certificate's subject, for the authentication to succeed.
<br>The subject header in the client certificate must contain comma(',') separated values, while the sm_certificate_subject_pattern must contain '/' separated values.

Note: All the annotations and flags values can be set/updated via helm.
<br>For registering the broker with SAP's Service Manager, please refer to the [interoperator-authentication](https://github.wdf.sap.corp/servicefabrik/interoperator-deployment-component/tree/master/docs/interoperator-authentication.md) for more details.

#### XRS registration
For details on XRS registration, please refer to the [xrs-registration](https://github.wdf.sap.corp/servicefabrik/interoperator-deployment-component/blob/master/docs/interoperator-authentication.md#xrs-registration) document.

### CIS Quota check
For mTLS support, please refer to the [interoperator-authentication](https://github.wdf.sap.corp/servicefabrik/interoperator-deployment-component/blob/master/docs/interoperator-authentication.md#cis-quota-check) "CIS Quota check" section, for details.