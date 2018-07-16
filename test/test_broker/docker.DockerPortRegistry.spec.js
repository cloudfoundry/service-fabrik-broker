'use strict';

const proxyquire = require('proxyquire');
const DockerPortRegistry = proxyquire('../../data-access-layer/docker/DockerPortRegistry', {
  lodash: {
    sample: function (collection) {
      return collection[2];
    }
  }
});

describe('docker', () => {
  describe('DockerPortRegistry', () => {
    let dockerPortRegistry = new DockerPortRegistry([1000, 34000]);

    describe('getPorts', () => {
      it('returns an array of integers', () => {
        expect(dockerPortRegistry.getPorts('abc')).to.have.length(0);
        expect(dockerPortRegistry.getPorts('abc')).to.eql([]);
        expect(dockerPortRegistry.getPorts('tcp')).to.have.length(1);
        expect(dockerPortRegistry.getPorts('tcp')).to.eql([33331]);
      });
    });

    describe('insert', () => {
      it('extends the array of used ports', () => {
        dockerPortRegistry.insert('tcp', 1234);

        expect(dockerPortRegistry.getPorts('tcp')).to.have.length(2);
        expect(dockerPortRegistry.getPorts('tcp')).to.eql([1234, 33331]);
      });

      it('does not extend the array of used ports (inserting an already used port)', () => {
        dockerPortRegistry.insert('tcp', 33331);

        expect(dockerPortRegistry.getPorts('tcp')).to.have.length(2);
      });
    });

    describe('reset', () => {
      it('resets the array of used ports', () => {
        dockerPortRegistry.reset();

        expect(dockerPortRegistry.getPorts('tcp')).to.have.length(1);
        expect(dockerPortRegistry.getPorts('tcp')).to.eql([33331]);
      });
    });

    describe('remove', () => {
      it('shrinks the array of used ports', () => {
        dockerPortRegistry.remove('tcp', 1234);

        expect(dockerPortRegistry.getPorts('tcp')).to.have.length(1);
        expect(dockerPortRegistry.getPorts('tcp')).to.eql([33331]);
      });
    });

    describe('update', () => {
      it('updates the array of used ports by adding new ports', () => {
        let containers = [{
          Ports: [{
            Type: 'tcp',
            PublicPort: 1337
          }, {
            Type: 'tcp',
            PublicPort: 1338
          }]
        }];
        dockerPortRegistry.update(containers);

        expect(dockerPortRegistry.getPorts('tcp')).to.have.length(3);
        expect(dockerPortRegistry.getPorts('tcp')).to.eql([1337, 1338, 33331]);
      });

      it('does not update the array of used ports', () => {
        dockerPortRegistry.update();
        expect(dockerPortRegistry.getPorts('tcp')).to.have.length(3);
      });

      it('updates the array of used ports by removing old ports', () => {
        let containers = [{
          Ports: [{
            Type: 'tcp',
            PublicPort: 1338
          }]
        }];
        dockerPortRegistry.update(containers);

        expect(dockerPortRegistry.getPorts('tcp')).to.have.length(2);
        expect(dockerPortRegistry.getPorts('tcp')).to.eql([1338, 33331]);
      });
    });

    describe('sample', () => {
      it('returns an unused port (integer)', () => {
        let port = dockerPortRegistry.sample('tcp');

        expect(port).to.eql(1002);
        expect(dockerPortRegistry.getPorts('tcp')).to.have.length(3);
        expect(dockerPortRegistry.getPorts('tcp')).to.eql([port, 1338, 33331]);
      });

      it('returns undefined since the given protocol does not exist', () => {
        dockerPortRegistry.range = [];
        let port = dockerPortRegistry.sample('uix');

        expect(port).to.eql(undefined);
      });
    });
  });
});