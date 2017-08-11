Configuration Parameters
========================

In order to properly instantiate an IaaS client via the ``create_iaas_client()`` function (which is documented `here <iaas_client.html>`_),
you **must** provide some parameters (like IaaS credentials or other configuration settings).
These parameters must be transfered in a dictionary to the function.

.. note::
    Currently, the parameters for both backup and restore are the same. However, the ``type`` parameter in the ``parse_options`` function
    exists for future compatibility.

General parameters
------------------

+-----------------+-------------------------------------------------------------------------------------------------------------------------------------------+
| ``iaas``        | The underlying IaaS provider. Possible values: ``aws``, ``openstack``                                                                     |
+-----------------+-------------------------------------------------------------------------------------------------------------------------------------------+
| ``type``        | Type of the backup (for restore operations it might be helpful to know how the backup was done): Possible values: ``online``, ``offline`` |
+-----------------+-------------------------------------------------------------------------------------------------------------------------------------------+
| ``instance_id`` | The Content-ID (IaaS-specific VM ID) of the machine on which the backup/restore operation should be performed.                            |
+-----------------+-------------------------------------------------------------------------------------------------------------------------------------------+
| ``secret``      | The password which is used for encryption/decryption of the files which are to be backed up/restored.                                     |
+-----------------+-------------------------------------------------------------------------------------------------------------------------------------------+
| ``location``    | An IaaS-specific BLOB storage container name (S3/Swift) to upload/download files to/from.                                                 |
+-----------------+-------------------------------------------------------------------------------------------------------------------------------------------+
| ``job_name``    | The name of the service job under which it is registered to ``monit`` (required for stop/start operations).                               |
+-----------------+-------------------------------------------------------------------------------------------------------------------------------------------+


IaaS-specific credentials parameters
------------------------------------

Depending on the IaaS provider, you need to state some credentials to enable the connection.

AWS
***

+-----------------------+-----------------------+
| ``access_key_id``     | AWS Access Key ID     |
+-----------------------+-----------------------+
| ``secret_access_key`` | AWS Secret Access Key |
+-----------------------+-----------------------+
| ``region_name``       | AWS Region Name       |
+-----------------------+-----------------------+

OpenStack
*********

+----------------------+------------------------------------------------------------+
| ``username``         | OpenStack user name with Swift privileges                  |
+----------------------+------------------------------------------------------------+
| ``password``         | OpenStack user password                                    |
+----------------------+------------------------------------------------------------+
| ``auth_url``         | OpenStack Keystone Authentication URL                      |
+----------------------+------------------------------------------------------------+
| ``user_domain_name`` | OpenStack Domain Name                                      |
+----------------------+------------------------------------------------------------+
| ``tenant_id``        | OpenStack ID of the tenant/project the VM is deployed in   |
+----------------------+------------------------------------------------------------+
| ``tenant_name``      | OpenStack Name of the tenant/project the VM is deployed in |
+----------------------+------------------------------------------------------------+

BOSH-Lite
*********

none

Example: Provide configuration from command line
------------------------------------------------

If you want to provide the configuration from the command line, one of the first things in your ``backup.py`` / ``restore.py`` script should be the parsing
of the the appropriate parameters. This can be done with the library function ``parse_options()`` you may import:

.. autofunction:: lib.config.parse_options

Having implemented your ``backup.py`` / ``restore.py`` script this way, the following calls are examples to start it:

AWS
***
::

    $ python3 backup.py \
        --iaas=aws \
        --type=offline \
        --instance_id=i-1a2b3c4d \
        --secret=foo \
        --location=bucket_in_s3 \
        --job_name=my_service \
        --access_key_id=abc \
        --secret_access_key=def \
        --region_name=eu-central-1

OpenStack
*********
::

    $ python3 backup.py \
        --iaas=openstack \
        --type=offline \
        --instance_id=4ef66e6d-1b0e-4eb2-b18b-9598057f8e39 \
        --secret=foo \
        --location=container_in_swift \
        --job_name=my_service \
        --username=swift-my-service \
        --password=secret \
        --auth_url=https://auth.url.openstack:5000/v3/ \
        --user_domain_name=HCP_CF_01 \
        --tenant_id=1a2b3c4d5e6f7g8h9i0j1a2b3c4d5e6f7g8h \
        --tenant_name=my-service

BOSH-Lite
*********
::

    $ python3 backup.py \
        --iaas=boshlite \
        --type=offline \
        --instance_id=4ef66e6d-1b0e-4eb2-b18b-9598057f8e39 \
        --secret=foo \
        --location=container_in_swift \
        --job_name=my_service

Example: Provide configuration manually
---------------------------------------

If you want to provide the configuration manually, you do not need to use the ``parse_options()`` function from the library. Instead, you transfer the configuration
directory to the ``create_iaas_client()`` function after defining the appropriate dictionary:

AWS
***
.. code-block:: python

    from service_fabrik_backup_restore import create_iaas_client
    ...
    configuration = {
      'iaas': 'aws',
      'type': 'offline',
      'instance_id': 'i-1a2b3c4d',
      'secret': 'foo',
      'location': 'bucket_in_s3',
      'job_name': 'my_service',
      'access_key_id': 'abc',
      'secret_access_key': 'def',
      'region_name': 'eu-central-1'
    }
    iaas_client = create_iaas_client('backup', configuration, ...)
    ...

OpenStack
*********
.. code-block:: python

    from service_fabrik_backup_restore import create_iaas_client
    ...
    configuration = {
      'iaas': 'openstack',
      'type': 'offline',
      'instance_id': '4ef66e6d-1b0e-4eb2-b18b-9598057f8e39',
      'secret': 'foo',
      'location': 'container_in_swift',
      'job_name': 'my_service',
      'username': 'swift-my-service',
      'password': 'secret',
      'auth_url': 'https://auth.url.openstack:5000/v3/',
      'user_domain_name': 'HCP_CF_01',
      'tenant_id': '1a2b3c4d5e6f7g8h9i0j1a2b3c4d5e6f7g8h',
      'tenant_name': 'my-service'
    }
    iaas_client = create_iaas_client('backup', configuration, ...)
    ...

BOSH-Lite
*********
.. code-block:: python

    from service_fabrik_backup_restore import create_iaas_client
    ...
    configuration = {
      'iaas': 'boshlite',
      'type': 'offline',
      'instance_id': '4ef66e6d-1b0e-4eb2-b18b-9598057f8e39',
      'secret': 'foo',
      'location': 'container_in_swift',
      'job_name': 'my_service'
    }
    iaas_client = create_iaas_client('backup', configuration, ...)
    ...
