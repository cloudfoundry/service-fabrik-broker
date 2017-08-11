Versions
========

The library is maintained by the Service Fabrik Team and improved continuously. We use semantic versioning (MAJOR.MINOR.PATCH).

Change Log
----------

**v1.2.2 (2016-12-07)**

- Introduced copy_snapshot function, currently defined only for AWS to create encrypted copy of snapshot.
- Introduced copy_directory function to recursively copy directories.
- Introduced download_from_blobstore_decrypt_extract function to download a file from BLOB storage and pipe it to a subprocess for decryption and decompression.

**v1.2.1 (2016-12-07)**

- Improved Python docstrings to clarify the purpose of ``initialize()`` and ``finalize()`` methods

**v1.2.0 (2016-12-07)**

- Implemented a BOSH-Lite client which can be used for local development before actually testing the scripts on a real infrastructure provider. This allows speeding up the development
  and the bug-fix process.
- Introduced a workaround for a ``boto3`` bug in its attach-volume method.
- Enabled the retrying logic for important methods. If an error occurs, it will retry at most 5 times with a waiting time of 10 seconds between each try and an overall waiting time of 10 minutes.
- Introduced ``initialize()`` and ``finalize()`` methods at the IaaS Client for convenience reasons. The ``initialize()`` method will set the last operation state to ``processing`` and
  log some initial statements. The ``finalize()`` method will set the last operation state to ``succeeded`` and log some final statements.
- The symbolic link logic for the last operation files introduced with ``v1.0.3`` has updated the link to the ``blue`` file for both backup and restore in the initialization phase. Now only
  the link of the current operation gets updated to the ``blue`` file.
- General improvements of log statements

**v1.1.0 (2016-11-30)**

- Enable uploads of files larger than 5 GB to Swift (http://docs.openstack.org/developer/swift/overview_large_objects.html)
- Use ``keystoneauth1`` module instead of the deprecated ``keystoneclient``
- Log statements are now also provided for the creation/extraction and encryption/decryption of tarballs/files 

**v1.0.3 (2016-11-09)**

- Important security fix: the GPG secret used for encryption/decryption is now hidden in the logs
- Last operation file is now written according to the *blue/green principle* to avoid issues of simultaneous reading/writing of the same file by two processes.
  E.g., for a ``backup``, the library creates two files ``backup.lastoperation.blue.json`` and ``backup.lastoperation.green.json``, and a symbolic link ``backup.lastoperation.json``
  which is always pointing to the file which is not currently updated/written by the library. This is to avoid conflicts occurring if two processes try to simultaneously read the same file. 

**v1.0.2 (2016-10-28)**

- Unmount volumes lazy to avoid errors during clean-ups because a device may be busy (improves reliability of clean-ups)

**v1.0.1 (2016-10-12)**

- Improve python doc-strings for better documentation

**v1.0.0 (2016-10-11)**

- Rename 'amazon' to 'aws'
- Remove ``get_logger`` function and add the logger to the IaaSClient class
- Change AWS S3 Access check due to changed policies
- Update list of methods which allow a safe abortion
- Improve log statements
- Remove certificates configurable via environment variable ``SF_BACKUP_RESTORE_CERTS`` and use default
