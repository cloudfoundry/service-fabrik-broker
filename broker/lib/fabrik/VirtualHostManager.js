const bosh = require('../../../data-access-layer/bosh');
const VirtualHostInstance = require('./VirtualHostInstance');
const BaseManager = require('./BaseManager');
const VirtualHostAgent = require('./VirtualHostAgent');
const mapper = require('./VirtualHostRelationMapper');

class VirtualHostManager extends BaseManager {
  constructor(plan) {
    super(plan);
    this.director = bosh.director;
    this.agent = new VirtualHostAgent(this.settings.agent);
    this.mapper = mapper.VirtualHostRelationMapper;
  }

  static get instanceConstructor() {
    return VirtualHostInstance;
  }
}
module.exports = VirtualHostManager;