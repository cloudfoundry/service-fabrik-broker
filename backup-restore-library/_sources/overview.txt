Overview
========

This library arose during the development of Backup & Restore for the `Blueprint-Service <https://github.com/sap/service-fabrik-blueprint-service>`_
as part of the `Service Fabrik <https://github.com/sap/service-fabrik-broker>`_'s Backup & Restore offering.
It can be used for two IaaS providers, Amazon Web Services and OpenStack, as it abstracts some basic functionalities, like volume creation/deletion/attaching/detaching,
by implementing provider-specific clients. However, for local development also a BOSH-Lite Client is provided which allows speeding up the development process before
actually testing the scripts on real infrastructure providers.
Service teams may like to use the library to avoid implementing the same features from scratch during their service-specific Backup & Restore development.


Features
--------

The following features are exposed:

* Abstraction of the underlying IaaS provider

* Implicit waiting for operations to be finished before further processing

* Implicit retry logic to catch briefly occurring infrastructure problems

* Reliable clean-up of created resources to avoid orphans (in case of errors)

* Proper exception handling in case of errors

* Enabling easy and transparent backup & restore implementations


Prerequisites
-------------

You need to have **Python3** as well as **pip3** installed. pip3 is used for the installation of the library's dependencies.
Please find further details on download and installation here:

* Python3: https://www.python.org/downloads/

* pip3: https://pip.pypa.io/en/stable/installing/


How to use this project
-----------------------

Assuming, your working directory is ``~/workspace/my_service``:

Clone this repository
*********************

* Most likely your working directory is already a git repository so that you may want to add this repository as submodule: ::

    $ cd ~/workspace/my_service
    $ git submodule add https://github.com/sap/service-fabrik-backup-restore.git service_fabrik_backup_restore

* Otherwise, just clone this repository (assuming your working directory is ``~/workspace/my_service``: ::

    $ cd ~/workspace/my_service
    $ git clone https://github.com/sap/service-fabrik-backup-restore.git service_fabrik_backup_restore


Install the dependencies
************************

pip3 is the PyPa recommended tool for installing Python packages: ::

    $ cd ~/workspace/my_service/service_fabrik_backup_restore
    $ pip3 install -r requirements.txt


Using the library
*****************

Basically, you have to create a new file, e.g. ``backup.py``, and import the Backup & Restore library: ::

    $ cd ~/workspace/my_service
    $ touch backup.py

Within the ``backup.py``, put this line at the top of the file:

.. code-block:: python

    from service_fabrik_backup_restore import create_iaas_client, parse_options

Now you can start implementing the backup / restore for your service and take advantage of this library's functionalities.
