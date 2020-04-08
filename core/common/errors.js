'use strict';

const CONST = require('./constants');

function createSymbol(name) {
  /* jshint newcap:false */
  return Symbol(name);
}

const descriptionSymbol = createSymbol('description');

class BaseError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode ? statusCode : CONST.ERR_STATUS_CODES.BROKER.DEFAULT;
    Error.captureStackTrace(this, this.constructor);
  }

  get description() {
    return this[descriptionSymbol] || this.message;
  }

  set description(description) {
    this[descriptionSymbol] = description;
  }
}
exports.BaseError = BaseError;

class SshConnectionFailed extends BaseError {
  constructor(message) {
    super(message);
    this.code = 'ETIMEDOUT';
  }
}
exports.SshConnectionFailed = SshConnectionFailed;

class DeploymentDelayed extends BaseError {
  constructor(deploymentName) {
    super(deploymentName);
    this.code = 'ECONTINUE';
  }
}
exports.DeploymentDelayed = DeploymentDelayed;

class ContinueWithNext extends BaseError {
  constructor() {
    super('Continue with next handler');
    this.code = 'ECONTINUE';
  }
}
exports.ContinueWithNext = ContinueWithNext;

class Timeout extends BaseError {
  constructor(message, error) {
    super(message);
    this.code = 'ETIMEDOUT';
    if (error instanceof Error) {
      this.error = error;
    } else if (typeof error === 'string') {
      this.error = new Error(error);
    }
  }
  static timedOut(time, err, operation) {
    const msg = `Operation ${operation ? operation + ' ' : ''}timed out after ${time} ms`;
    return new Timeout(msg, err);
  }
  static toManyAttempts(attempts, err, operation) {
    const msg = `Operation ${operation ? operation + ' ' : ''}failed after ${attempts} attempts`;
    return new Timeout(msg, err);
  }
}
exports.Timeout = Timeout;

class ServiceInMaintenance extends BaseError {
  constructor(message, error) {
    super(message);
    this.code = CONST.ERR_CODES.SF_IN_MAINTENANCE;
    if (error instanceof Error) {
      this.error = error;
    } else if (typeof error === 'string') {
      this.error = new Error(error);
    }
  }
  static getInstance(maintenanceInfo) {
    if (maintenanceInfo) {
      return new ServiceInMaintenance(`Service Fabrik is currently under maintenance. Version upgrade from ${maintenanceInfo.fromVersion} to ${maintenanceInfo.toVersion} started at ${maintenanceInfo.createdAt}`, maintenanceInfo);
    }
    return new ServiceInMaintenance('Service Fabrik is currently under maintenance');
  }
}
exports.ServiceInMaintenance = ServiceInMaintenance;

class NotImplementedBySubclass extends BaseError {
  constructor(method) {
    super(`Method '${method}' must be implemented by subclass`);
  }
}
exports.NotImplementedBySubclass = NotImplementedBySubclass;

class InstanceSharingNotAllowed extends BaseError {
  constructor() {
    super('Service instance sharing not enabled');
  }
}
exports.InstanceSharingNotAllowed = InstanceSharingNotAllowed;

class CrossOrganizationSharingNotAllowed extends BaseError {
  constructor() {
    super('Service instance cannot be shared across Cloud Foundry organizations');
  }
}
exports.CrossOrganizationSharingNotAllowed = CrossOrganizationSharingNotAllowed;

class HttpError extends BaseError {
  constructor(status, reason, message, statusCode) {
    super(message, statusCode);
    this.status = status;
    this.reason = reason;
  }
}
exports.HttpError = HttpError;

class HttpClientError extends HttpError {
  constructor(status, reason, message, statusCode) {
    super(status, reason, message, statusCode);
  }
}
exports.HttpClientError = HttpClientError;

class BadRequest extends HttpClientError {
  constructor(message, statusCode) {
    super(CONST.HTTP_STATUS_CODE.BAD_REQUEST, 'Bad Request', message, statusCode);
  }
}
exports.BadRequest = BadRequest;

class InvalidServiceParameters extends BadRequest {
  constructor(message) {
    super(message);
  }
}
exports.InvalidServiceParameters = InvalidServiceParameters;

class Unauthorized extends HttpClientError {
  constructor(message) {
    super(CONST.HTTP_STATUS_CODE.UNAUTHORIZED, 'Unauthorized', message || 'The request requires user authentication');
  }
}
exports.Unauthorized = Unauthorized;

class Forbidden extends HttpClientError {
  constructor(message) {
    super(CONST.HTTP_STATUS_CODE.FORBIDDEN, 'Forbidden', message);
  }
}
exports.Forbidden = Forbidden;

class NotFound extends HttpClientError {
  constructor(message, statusCode) {
    super(CONST.HTTP_STATUS_CODE.NOT_FOUND, 'Not Found', message, statusCode);
  }
}
exports.NotFound = NotFound;

class PageNotFound extends NotFound {
  constructor(message, statusCode) {
    super(CONST.HTTP_STATUS_CODE.NOT_FOUND, 'Page Not Found', message, statusCode);
  }  
}

exports.PageNotFound = PageNotFound;

class MethodNotAllowed extends HttpClientError {
  constructor(method, allow) {
    let message = `The method ${method} is not allowed for the resource identified by the URI`;
    super(CONST.HTTP_STATUS_CODE.METHOD_NOT_ALLOWED, 'Method Not Allowed', message);
    this.allow = allow;
  }
}
exports.MethodNotAllowed = MethodNotAllowed;

class NotAcceptable extends HttpClientError {
  constructor(message) {
    super(CONST.HTTP_STATUS_CODE.NOT_ACCEPTABLE, 'NotAcceptable', message);
  }
}
exports.NotAcceptable = NotAcceptable;

class Conflict extends HttpClientError {
  constructor(message) {
    super(CONST.HTTP_STATUS_CODE.CONFLICT, 'Conflict', message);
  }
}
exports.Conflict = Conflict;

class Gone extends HttpClientError {
  constructor(message) {
    super(CONST.HTTP_STATUS_CODE.GONE, 'Gone', message);
  }
}
exports.Gone = Gone;

class PreconditionFailed extends HttpClientError {
  constructor(message) {
    super(CONST.HTTP_STATUS_CODE.PRECONDITION_FAILED, 'Precondition Failed', message);
  }
}
exports.PreconditionFailed = PreconditionFailed;

class UnprocessableEntity extends HttpClientError {
  constructor(message, reason) {
    super(CONST.HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY, reason || 'Unprocessable Entity', message);
  }
}
exports.UnprocessableEntity = UnprocessableEntity;

class DeploymentAlreadyLocked extends UnprocessableEntity {
  // TOOD - PR - 
  // This error is used for showing deployment being locked, so at some other place in code it would be still sending in deployment Name, so please check that code as well.
  constructor(instanceId, lockInfo, lockMessage) {
    let message = `Service Instance ${instanceId} ${CONST.OPERATION_TYPE.LOCK}`;
    if (lockInfo) {
      message = `${message} at ${lockInfo.createdAt} for ${lockInfo.lockForOperation}`;
    } else if (lockMessage !== undefined) {
      message = lockMessage;
    }
    super(message);
  }
}
exports.DeploymentAlreadyLocked = DeploymentAlreadyLocked;

class DeploymentAttemptRejected extends UnprocessableEntity {
  constructor(deploymentName) {
    let message = `Deployment ${deploymentName} ${CONST.FABRIK_OPERATION_STAGGERED}, Reason: ${CONST.FABRIK_OPERATION_COUNT_EXCEEDED}`;
    super(message);
  }
}
exports.DeploymentAttemptRejected = DeploymentAttemptRejected;

class ServiceNotFound extends NotFound {
  constructor(id) {
    super(`Could not find Service with ID ${id}`);
  }
}
exports.ServiceNotFound = ServiceNotFound;

class ServicePlanNotFound extends NotFound {
  constructor(id) {
    super(`Could not find Service Plan with ID ${id}`);
  }
}
exports.ServicePlanNotFound = ServicePlanNotFound;

class ServiceInstanceNotOperational extends UnprocessableEntity {
  constructor(id) {
    super(`Service Instance with ID ${id} is not operational`);
  }
}
exports.ServiceInstanceNotOperational = ServiceInstanceNotOperational;

class ServiceInstanceNotFound extends NotFound {
  constructor(id) {
    super(`Could not find Service Instance with ID ${id}`, CONST.ERR_STATUS_CODES.BOSH.DEPLOYMENT_NOT_FOUND);
  }
}
exports.ServiceInstanceNotFound = ServiceInstanceNotFound;

class ServiceInstanceAlreadyExists extends BadRequest {
  constructor(id) {
    super(`Service Instance with ID ${id} already exists`, CONST.ERR_STATUS_CODES.BOSH.DEPLOYMENT_ALREADY_EXISTS);
  }
}
exports.ServiceInstanceAlreadyExists = ServiceInstanceAlreadyExists;

class ServiceBindingNotFound extends NotFound {
  constructor(id) {
    super(`Could not find Service Binding with ID ${id}`);
  }
}
exports.ServiceBindingNotFound = ServiceBindingNotFound;

class ServiceBindingAlreadyExists extends BadRequest {
  constructor(id) {
    super(`Service Binding with ID ${id} already exists`);
  }
}
exports.ServiceBindingAlreadyExists = ServiceBindingAlreadyExists;

class SecurityGroupNotFound extends NotFound {
  constructor(name) {
    super(`Could not find Security Group with name ${name}`);
  }
}
exports.SecurityGroupNotFound = SecurityGroupNotFound;

class ServiceBrokerNotFound extends NotFound {
  constructor(name) {
    super(`Could not find Service Broker with name ${name}`);
  }
}
exports.ServiceBrokerNotFound = ServiceBrokerNotFound;

class AsyncRequired extends UnprocessableEntity {
  constructor() {
    super('Service Plan requires support for asynchronous operations');
  }
}
exports.AsyncRequired = AsyncRequired;

class HttpServerError extends HttpError {
  constructor(status, reason, message, statusCode) {
    super(status, reason, message, statusCode);
  }
}
exports.HttpServerError = HttpServerError;

class InternalServerError extends HttpServerError {
  constructor(message) {
    super(500, 'Internal Server Error', message);
  }
}
exports.InternalServerError = InternalServerError;

class ContainerStartError extends InternalServerError {
  constructor(message) {
    super(message);
  }
}
exports.ContainerStartError = ContainerStartError;

class SecurityGroupNotCreated extends InternalServerError {
  constructor(name) {
    super(`Failed to create security group '${name}'`);
  }
}
exports.SecurityGroupNotCreated = SecurityGroupNotCreated;

class NotImplemented extends HttpServerError {
  constructor(message) {
    super(501, 'Not Implemented', message);
  }
}
exports.NotImplemented = NotImplemented;

class BadGateway extends HttpServerError {
  constructor(message) {
    super(502, 'Bad Gateway', message);
  }
}
exports.BadGateway = BadGateway;

class FeatureNotSupportedByAnyAgent extends BadGateway {
  constructor(feature) {
    super(`Could not find any Agent supporting feature '${feature}'`);
  }
}
exports.FeatureNotSupportedByAnyAgent = FeatureNotSupportedByAnyAgent;

class ServiceUnavailable extends HttpServerError {
  constructor(message, statusCode) {
    super(503, 'Service Unavailable', message, statusCode);
  }
}
exports.ServiceUnavailable = ServiceUnavailable;

class DirectorServiceUnavailable extends ServiceUnavailable {
  constructor(message) {
    super(message, CONST.ERR_STATUS_CODES.BOSH.DIRECTOR_UNAVAILABLE);
  }
}
exports.DirectorServiceUnavailable = DirectorServiceUnavailable;

class DockerServiceUnavailable extends ServiceUnavailable {
  constructor(message) {
    super(message, CONST.ERR_STATUS_CODES.DOCKER.DOCKER_UNAVAILABLE);
  }
}
exports.DockerServiceUnavailable = DockerServiceUnavailable;

class DBUnavailable extends HttpServerError {
  constructor(message) {
    super(503, 'DB Unavailable', message);
  }
}
exports.DBUnavailable = DBUnavailable;
