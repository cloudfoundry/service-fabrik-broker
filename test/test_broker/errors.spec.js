'use strict';

const errors = require('../../common/errors');
const CONST = require('../../common/constants');
const HttpError = errors.HttpError;
const HttpClientError = errors.HttpClientError;
const Timeout = errors.Timeout;
const ServiceInMaintenance = errors.ServiceInMaintenance;
const NotImplementedBySubclass = errors.NotImplementedBySubclass;
const BadRequest = errors.BadRequest;
const Unauthorized = errors.Unauthorized;
const Forbidden = errors.Forbidden;
const NotFound = errors.NotFound;
const MethodNotAllowed = errors.MethodNotAllowed;
const NotAcceptable = errors.NotAcceptable;
const Conflict = errors.Conflict;
const Gone = errors.Gone;
const PreconditionFailed = errors.PreconditionFailed;
const UnprocessableEntity = errors.UnprocessableEntity;
const DeploymentAlreadyLocked = errors.DeploymentAlreadyLocked;
const ServiceInstanceNotOperational = errors.ServiceInstanceNotOperational;
const ServiceNotFound = errors.ServiceNotFound;
const ServicePlanNotFound = errors.ServicePlanNotFound;
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const ServiceBrokerNotFound = errors.ServiceBrokerNotFound;
const ServiceInstanceAlreadyExists = errors.ServiceInstanceAlreadyExists;
const ServiceBindingNotFound = errors.ServiceBindingNotFound;
const SecurityGroupNotFound = errors.SecurityGroupNotFound;
const AsyncRequired = errors.AsyncRequired;
const HttpServerError = errors.HttpServerError;
const InternalServerError = errors.InternalServerError;
const ContainerStartError = errors.ContainerStartError;
const SecurityGroupNotCreated = errors.SecurityGroupNotCreated;
const NotImplemented = errors.NotImplemented;
const BadGateway = errors.BadGateway;
const ServiceUnavailable = errors.ServiceUnavailable;
const DirectorServiceUnavailable = errors.DirectorServiceUnavailable;
const DockerServiceUnavailable = errors.DockerServiceUnavailable;

describe('errors', () => {
  let status = 100;
  let reason = 'reason';
  let message = 'message';

  describe('Timeout', () => {
    let error = 'error';
    let timeOut = new Timeout(message, error);
    it('sets the class properties correctly', () => {
      expect(timeOut.name).to.eql('Timeout');
      expect(timeOut.code).to.eql('ETIMEDOUT');
    });

    it('sets the class properties correctly with error', () => {
      let expectedError = new Error(error);
      timeOut = new Timeout(message, expectedError);
      expect(timeOut.error).to.eql(expectedError);
      expect(timeOut.code).to.eql('ETIMEDOUT');
    });

    it('returns timedOut error', () => {
      let time = 'time';
      const timedOut = Timeout.timedOut(time, error);
      expect(timedOut.message).to.eql(`Operation timed out after ${time} ms`);
      expect(timedOut.name).to.eql('Timeout');
      expect(timedOut.code).to.eql('ETIMEDOUT');
    });

    it('returns tooManyAttempts error', () => {
      let attempts = 2;
      const tooManyAttempts = Timeout.toManyAttempts(attempts, error);
      expect(tooManyAttempts.message).to.eql(`Operation failed after ${attempts} attempts`);
      expect(tooManyAttempts.name).to.eql('Timeout');
      expect(tooManyAttempts.code).to.eql('ETIMEDOUT');
    });
  });

  describe('ServiceInMaintenance', () => {
    let error = 'error';
    let serviceInMaintenance = new ServiceInMaintenance(message, error);

    it('sets the class properties correctly', () => {
      expect(serviceInMaintenance.name).to.eql('ServiceInMaintenance');
      expect(serviceInMaintenance.code).to.eql(CONST.ERR_CODES.SF_IN_MAINTENANCE);
    });

    it('sets the class properties correctly with error', () => {
      let expectedError = new Error(error);
      serviceInMaintenance = new ServiceInMaintenance(message, expectedError);
      expect(serviceInMaintenance.error).to.eql(expectedError);
      expect(serviceInMaintenance.code).to.eql(CONST.ERR_CODES.SF_IN_MAINTENANCE);
    });

    it('returns sf under maintainance error', () => {
      serviceInMaintenance = ServiceInMaintenance.getInstance();
      expect(serviceInMaintenance.message).to.eql('Service Fabrik is currently under maintenance');
      expect(serviceInMaintenance.code).to.eql(CONST.ERR_CODES.SF_IN_MAINTENANCE);
    });

    it('returns sf under maintainance error with maintainance info', () => {
      let maintenanceInfo = {
        fromVersion: 'from',
        toVersion: 'to',
        createdAt: 'time'
      };
      serviceInMaintenance = ServiceInMaintenance.getInstance(maintenanceInfo);
      expect(serviceInMaintenance.message).to.eql(`Service Fabrik is currently under maintenance. Version upgrade from ${maintenanceInfo.fromVersion} to ${maintenanceInfo.toVersion} started at ${maintenanceInfo.createdAt}`);
      expect(serviceInMaintenance.code).to.eql(CONST.ERR_CODES.SF_IN_MAINTENANCE);
    });
  });

  describe('NotImplementedBySubclass', () => {
    let method = 'method';
    let notImplementedBySubclass = new NotImplementedBySubclass(method);

    it('sets the class properties correctly', () => {
      expect(notImplementedBySubclass.message).to.eql(`Method '${method}' must be implemented by subclass`);
    });
  });

  describe('HttpError', () => {
    let httpError = new HttpError(status, reason, message);

    describe('description', () => {
      it('sets and gets the description', () => {
        let description = 'foobar';
        httpError.description = description;
        expect(httpError.description).to.eql(description);
      });
    });
  });

  describe('HttpClientError', () => {
    let httpClientError = new HttpClientError(status, reason, message);

    it('sets the class properties correctly', () => {
      expect(httpClientError.status).to.eql(status);
      expect(httpClientError.reason).to.eql(reason);
      expect(httpClientError.message).to.eql(message);
    });
  });

  describe('BadRequest', () => {
    let badRequest = new BadRequest(message);

    it('sets the class properties correctly', () => {
      expect(badRequest.status).to.eql(400);
      expect(badRequest.reason).to.eql('Bad Request');
      expect(badRequest.message).to.eql(message);
    });
  });

  describe('Unauthorized', () => {
    it('sets the class properties correctly (using a message)', () => {
      let unauthorized = new Unauthorized(message);
      expect(unauthorized.status).to.eql(401);
      expect(unauthorized.reason).to.eql('Unauthorized');
      expect(unauthorized.message).to.eql(message);
    });

    it('sets the class properties correctly (not using a message)', () => {
      let unauthorized = new Unauthorized();
      expect(unauthorized.status).to.eql(401);
      expect(unauthorized.reason).to.eql('Unauthorized');
      expect(unauthorized.message).to.eql('The request requires user authentication');
    });
  });

  describe('Forbidden', () => {
    let forbidden = new Forbidden(message);

    it('sets the class properties correctly', () => {
      expect(forbidden.status).to.eql(403);
      expect(forbidden.reason).to.eql('Forbidden');
      expect(forbidden.message).to.eql(message);
    });
  });

  describe('NotFound', () => {
    let notFound = new NotFound(message);

    it('sets the class properties correctly', () => {
      expect(notFound.status).to.eql(404);
      expect(notFound.reason).to.eql('Not Found');
      expect(notFound.message).to.eql(message);
    });
  });

  describe('MethodNotAllowed', () => {
    let method = 'POST';
    let allow = 'GET';
    let methodNotAllowed = new MethodNotAllowed(method, allow);

    it('sets the class properties correctly', () => {
      expect(methodNotAllowed.status).to.eql(405);
      expect(methodNotAllowed.reason).to.eql('Method Not Allowed');
      expect(methodNotAllowed.message).to.eql(`The method ${method} is not allowed for the resource identified by the URI`);
      expect(methodNotAllowed.allow).to.eql(allow);
    });
  });

  describe('NotAcceptable', () => {
    let notAcceptable = new NotAcceptable(message);

    it('sets the class properties correctly', () => {
      expect(notAcceptable.status).to.eql(406);
      expect(notAcceptable.reason).to.eql('NotAcceptable');
      expect(notAcceptable.message).to.eql(message);
    });
  });

  describe('Conflict', () => {
    let conflict = new Conflict(message);

    it('sets the class properties correctly', () => {
      expect(conflict.status).to.eql(409);
      expect(conflict.reason).to.eql('Conflict');
      expect(conflict.message).to.eql(message);
    });
  });

  describe('Gone', () => {
    let gone = new Gone(message);

    it('sets the class properties correctly', () => {
      expect(gone.status).to.eql(410);
      expect(gone.reason).to.eql('Gone');
      expect(gone.message).to.eql(message);
    });
  });

  describe('PreconditionFailed', () => {
    let preconditionFailed = new PreconditionFailed(message);

    it('sets the class properties correctly', () => {
      expect(preconditionFailed.status).to.eql(412);
      expect(preconditionFailed.reason).to.eql('Precondition Failed');
      expect(preconditionFailed.message).to.eql(message);
    });
  });

  describe('UnprocessableEntity', () => {
    let unprocessableEntity = new UnprocessableEntity(message);

    it('sets the class properties correctly', () => {
      expect(unprocessableEntity.status).to.eql(422);
      expect(unprocessableEntity.reason).to.eql('Unprocessable Entity');
      expect(unprocessableEntity.message).to.eql(message);
    });
  });

  describe('DeploymentAlreadyLocked', () => {
    let deploymentName = 'deployment';
    let lockInfo = {
      username: 'user',
      lockForOperation: 'operation',
      createdAt: 'time'
    };
    let lockMessage = 'Lock Message';

    it('sets the class properties correctly', () => {
      let deploymentAlreadyLocked = new DeploymentAlreadyLocked(deploymentName);
      expect(deploymentAlreadyLocked.status).to.eql(CONST.HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY);
      expect(deploymentAlreadyLocked.reason).to.eql('Unprocessable Entity');
      expect(deploymentAlreadyLocked.message).to.eql(`Service Instance ${deploymentName} ${CONST.OPERATION_TYPE.LOCK}`);
    });

    it('sets the class properties correctly with lockinfo', () => {
      let deploymentAlreadyLocked = new DeploymentAlreadyLocked(deploymentName, lockInfo);
      expect(deploymentAlreadyLocked.status).to.eql(CONST.HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY);
      expect(deploymentAlreadyLocked.reason).to.eql('Unprocessable Entity');
      expect(deploymentAlreadyLocked.message).to.eql(`Service Instance ${deploymentName} ${CONST.OPERATION_TYPE.LOCK} at ${lockInfo.createdAt} for ${lockInfo.lockForOperation}`);
    });

    it('sets the class properties correctly with lock message', () => {
      let deploymentAlreadyLocked = new DeploymentAlreadyLocked(deploymentName, undefined, lockMessage);
      expect(deploymentAlreadyLocked.status).to.eql(CONST.HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY);
      expect(deploymentAlreadyLocked.reason).to.eql('Unprocessable Entity');
      expect(deploymentAlreadyLocked.message).to.eql(lockMessage);
    });
  });

  describe('ServiceInstanceNotOperational', () => {
    let serviceInstanceNotOperational = new ServiceInstanceNotOperational(message);

    it('sets the class properties correctly', () => {
      expect(serviceInstanceNotOperational.status).to.eql(422);
      expect(serviceInstanceNotOperational.reason).to.eql('Unprocessable Entity');
      expect(serviceInstanceNotOperational.message).to.eql(`Service Instance with ID ${message} is not operational`);
    });
  });

  describe('ServiceNotFound', () => {
    let id = 1;
    let serviceNotFound = new ServiceNotFound(id);

    it('sets the class properties correctly', () => {
      expect(serviceNotFound.status).to.eql(404);
      expect(serviceNotFound.reason).to.eql('Not Found');
      expect(serviceNotFound.message).to.eql(`Could not find Service with ID ${id}`);
    });
  });

  describe('ServicePlanNotFound', () => {
    let id = 1;
    let servicePlanNotFound = new ServicePlanNotFound(id);

    it('sets the class properties correctly', () => {
      expect(servicePlanNotFound.status).to.eql(404);
      expect(servicePlanNotFound.reason).to.eql('Not Found');
      expect(servicePlanNotFound.message).to.eql(`Could not find Service Plan with ID ${id}`);
    });
  });

  describe('ServiceInstanceNotFound', () => {
    let id = 1;
    let serviceInstanceNotFound = new ServiceInstanceNotFound(id);

    it('sets the class properties correctly', () => {
      expect(serviceInstanceNotFound.status).to.eql(404);
      expect(serviceInstanceNotFound.statusCode).to.eql(20004);
      expect(serviceInstanceNotFound.reason).to.eql('Not Found');
      expect(serviceInstanceNotFound.message).to.eql(`Could not find Service Instance with ID ${id}`);
    });
  });

  describe('ServiceBrokerNotFound', () => {
    let name = 'name';
    let serviceBrokerNotFound = new ServiceBrokerNotFound(name);

    it('sets the class properties correctly', () => {
      expect(serviceBrokerNotFound.status).to.eql(404);
      expect(serviceBrokerNotFound.reason).to.eql('Not Found');
      expect(serviceBrokerNotFound.message).to.eql(`Could not find Service Broker with name ${name}`);
    });
  });

  describe('ServiceInstanceAlreadyExists', () => {
    let id = 1;
    let serviceInstanceAlreadyExists = new ServiceInstanceAlreadyExists(id);

    it('sets the class properties correctly', () => {
      expect(serviceInstanceAlreadyExists.status).to.eql(400);
      expect(serviceInstanceAlreadyExists.statusCode).to.eql(20009);
      expect(serviceInstanceAlreadyExists.reason).to.eql('Bad Request');
      expect(serviceInstanceAlreadyExists.message).to.eql(`Service Instance with ID ${id} already exists`);
    });
  });

  describe('ServiceBindingNotFound', () => {
    let id = 1;
    let serviceBindingNotFound = new ServiceBindingNotFound(id);

    it('sets the class properties correctly', () => {
      expect(serviceBindingNotFound.status).to.eql(404);
      expect(serviceBindingNotFound.reason).to.eql('Not Found');
      expect(serviceBindingNotFound.message).to.eql(`Could not find Service Binding with ID ${id}`);
    });
  });

  describe('SecurityGroupNotFound', () => {
    let name = 1;
    let securityGroupNotFound = new SecurityGroupNotFound(name);

    it('sets the class properties correctly', () => {
      expect(securityGroupNotFound.status).to.eql(404);
      expect(securityGroupNotFound.reason).to.eql('Not Found');
      expect(securityGroupNotFound.message).to.eql(`Could not find Security Group with name ${name}`);
    });
  });

  describe('AsyncRequired', () => {
    let asyncRequired = new AsyncRequired();

    it('sets the class properties correctly', () => {
      expect(asyncRequired.status).to.eql(422);
      expect(asyncRequired.reason).to.eql('Unprocessable Entity');
      expect(asyncRequired.message).to.eql(`Service Plan requires support for asynchronous operations`);
    });
  });

  describe('HttpServerError', () => {
    let status = 500;
    let reason = 'reason';
    let message = 'message';
    let httpServerError = new HttpServerError(status, reason, message);

    it('sets the class properties correctly', () => {
      expect(httpServerError.status).to.eql(status);
      expect(httpServerError.reason).to.eql(reason);
      expect(httpServerError.message).to.eql(message);
    });
  });

  describe('InternalServerError', () => {
    let internalServerError = new InternalServerError(message);

    it('sets the class properties correctly', () => {
      expect(internalServerError.status).to.eql(500);
      expect(internalServerError.reason).to.eql('Internal Server Error');
      expect(internalServerError.message).to.eql(message);
    });
  });

  describe('ContainerStartError', () => {
    let containerStartError = new ContainerStartError(message);

    it('sets the class properties correctly', () => {
      expect(containerStartError.status).to.eql(500);
      expect(containerStartError.reason).to.eql('Internal Server Error');
      expect(containerStartError.message).to.eql(message);
    });
  });

  describe('SecurityGroupNotCreated', () => {
    let name = 'name';
    let securityGroupNotCreated = new SecurityGroupNotCreated(name);

    it('sets the class properties correctly', () => {
      expect(securityGroupNotCreated.status).to.eql(500);
      expect(securityGroupNotCreated.reason).to.eql('Internal Server Error');
      expect(securityGroupNotCreated.message).to.eql(`Failed to create security group '${name}'`);
    });
  });

  describe('NotImplemented', () => {
    let notImplemented = new NotImplemented(message);

    it('sets the class properties correctly', () => {
      expect(notImplemented.status).to.eql(501);
      expect(notImplemented.reason).to.eql('Not Implemented');
      expect(notImplemented.message).to.eql(message);
    });
  });

  describe('BadGateway', () => {
    let badGateway = new BadGateway(message);

    it('sets the class properties correctly', () => {
      expect(badGateway.status).to.eql(502);
      expect(badGateway.reason).to.eql('Bad Gateway');
      expect(badGateway.message).to.eql(message);
    });
  });
  describe('ServiceUnavailable', () => {
    let serviceUnavailable = new ServiceUnavailable(message);

    it('sets the class properties correctly', () => {
      expect(serviceUnavailable.status).to.eql(503);
      expect(serviceUnavailable.reason).to.eql('Service Unavailable');
      expect(serviceUnavailable.message).to.eql(message);
    });
  });
  describe('DirectorServiceUnavailable', () => {
    let directorServiceUnavailable = new DirectorServiceUnavailable(message);

    it('sets the class properties correctly', () => {
      expect(directorServiceUnavailable.status).to.eql(503);
      expect(directorServiceUnavailable.statusCode).to.eql(20003);
      expect(directorServiceUnavailable.reason).to.eql('Service Unavailable');
      expect(directorServiceUnavailable.message).to.eql(message);
    });
  });

  describe('DockerServiceUnavailable', () => {
    let dockerServiceUnavailable = new DockerServiceUnavailable(message);

    it('sets the class properties correctly', () => {
      expect(dockerServiceUnavailable.status).to.eql(503);
      expect(dockerServiceUnavailable.statusCode).to.eql(30003);
      expect(dockerServiceUnavailable.reason).to.eql('Service Unavailable');
      expect(dockerServiceUnavailable.message).to.eql(message);
    });
  });
});