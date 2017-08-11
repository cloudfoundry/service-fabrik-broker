IaaS Client API Reference
=========================

To instantiate an IaaS client which abstracts the underlying provider specifics you have to import the ``create_iaas_client()`` function from the library:

.. autofunction:: lib.clients.index.create_iaas_client

The following methods can be used to interact with the IaaS, independently from the actual provider (thus, you have to implement backup/restore only *once*):

.. note::

  You should use the ``initialize()`` and ``finalize()`` methods in order to update your last operation state approriately at the beginning and the end.

General
-------

.. automethod:: lib.clients.BaseClient.BaseClient.initialize
.. automethod:: lib.clients.BaseClient.BaseClient.finalize
.. automethod:: lib.clients.BaseClient.BaseClient.shell
.. automethod:: lib.clients.BaseClient.BaseClient.last_operation
.. automethod:: lib.clients.BaseClient.BaseClient.clean_up
.. automethod:: lib.clients.BaseClient.BaseClient.exit

Volumes
-------

.. automethod:: lib.clients.BaseClient.BaseClient.get_volume
.. automethod:: lib.clients.BaseClient.BaseClient.get_attached_volumes_for_instance
.. automethod:: lib.clients.BaseClient.BaseClient.get_persistent_volume_for_instance
.. automethod:: lib.clients.BaseClient.BaseClient.create_volume
.. automethod:: lib.clients.BaseClient.BaseClient.delete_volume
.. automethod:: lib.clients.BaseClient.BaseClient.create_attachment
.. automethod:: lib.clients.BaseClient.BaseClient.delete_attachment

Snapshots
---------

.. automethod:: lib.clients.BaseClient.BaseClient.get_snapshot
.. automethod:: lib.clients.BaseClient.BaseClient.create_snapshot
.. automethod:: lib.clients.BaseClient.BaseClient.delete_snapshot

Mounting and Formatting
-----------------------

.. automethod:: lib.clients.BaseClient.BaseClient.get_mountpoint
.. automethod:: lib.clients.BaseClient.BaseClient.mount_device
.. automethod:: lib.clients.BaseClient.BaseClient.unmount_device
.. automethod:: lib.clients.BaseClient.BaseClient.format_device

Encrypt Directories and Files
-----------------------------

.. automethod:: lib.clients.BaseClient.BaseClient.create_and_encrypt_tarball_of_directory
.. automethod:: lib.clients.BaseClient.BaseClient.decrypt_and_extract_tarball_of_directory
.. automethod:: lib.clients.BaseClient.BaseClient.encrypt_file
.. automethod:: lib.clients.BaseClient.BaseClient.decrypt_file

BLOB Storage Interaction
------------------------

.. automethod:: lib.clients.BaseClient.BaseClient.get_container
.. automethod:: lib.clients.BaseClient.BaseClient.upload_to_blobstore
.. automethod:: lib.clients.BaseClient.BaseClient.download_from_blobstore

Miscellaneous Functions
-----------------------

.. automethod:: lib.clients.BaseClient.BaseClient.start_service_job
.. automethod:: lib.clients.BaseClient.BaseClient.stop_service_job
.. automethod:: lib.clients.BaseClient.BaseClient.wait_for_service_job_status
.. automethod:: lib.clients.BaseClient.BaseClient.create_directory
.. automethod:: lib.clients.BaseClient.BaseClient.delete_directory
