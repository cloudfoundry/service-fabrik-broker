Logging and Last Operation
==========================

The library has already included a logging mechanism. A logger is initialized while creating an IaaS client and bound to the instance.
However, the implemented methods of the IaaS client already log their current operations, so that you basically do not the logger.
Anyway, if you want to log specific messages, you can use the following functions on your IaaS client instance:

Log levels
----------

.. automethod:: lib.logger.Logger.debug
.. automethod:: lib.logger.Logger.info
.. automethod:: lib.logger.Logger.warning
.. automethod:: lib.logger.Logger.error
.. automethod:: lib.logger.Logger.critical

Log file
--------

The path of the log file can be set via the environment variable ``SF_BACKUP_RESTORE_LOG_DIRECTORY``. The library will create a file based on the
``operation_name`` you provided while instantiating an IaaS client (see the reference of the creator function `here <iaas_client.html>`_).
For example, if the ``operation_name`` is `backup`, the log file will have the name ``backup.log`` in the ``SF_BACKUP_RESTORE_LOG_DIRECTORY``.

The log file contains log messages in the following format, separated by newlines:

.. code-block:: python

    { "time": "2016-08-31T11:16:50+00:00", "level": "info", "msg": "Create volume" }


Last Operation file
-------------------

Furthermore, you should set the path of the directory of the *last operation files* which are updated by library for each state or stage it reaches. This can
be done via the environment variable ``SF_BACKUP_RESTORE_LAST_OPERATION_DIRECTORY``. The library will create two files based on the ``operation_name`` you provided while
instantiating an IaaS client (see the reference of the creator function `here <iaas_client.html>`_). For example, with ``operation_name='backup'`` there will be
``backup.lastoperation.blue.json``, ``backup.lastoperation.green.json``, and a symbolic link ``backup.lastoperation.json`` created  in the ``SF_BACKUP_RESTORE_LAST_OPERATION_DIRECTORY``.
The symbolic link is always pointing to the file which is *not* currently updated/written by the library. This prevents issues of simultaneous reading/writing of the same 
file by two processes. Thus, to find out the last operation state, it is recommend to only read ``backup.lastoperation.json`` or ``restore.lastoperation.json``, respectively.

The files contain the state and stage of the last operation in the following format:

.. code-block:: python

    { "state": "processing", "stage": "Create volume", "updated_at": "2015-11-18T11:28:42+00:00" }

.. note::
    Please note that the files are re-used and will be overwritten for each usage of the library.
