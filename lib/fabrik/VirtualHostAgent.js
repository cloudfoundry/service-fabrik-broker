const Agent = require('./Agent');

class VirtualHostAgent extends Agent{

    constructor(settings) {
        super({
          json: true
        });
        this.settings = settings;
    }
    get features() {
        return this.settings.supported_features || [];
    }
    provision(ips, parameters){
        const body = {
            parameters: parameters
          };
          return this
            .getHost(ips, 'credentials')
            .then(ip => this.post(ip, 'tenants/abcd/lifecycle/provision', body, 200));
    }

    deprovision(){

    }

    createCredentials(ips, parameters){

    }

    deleteCredentials(){

    }
}
module.exports = VirtualHostAgent;