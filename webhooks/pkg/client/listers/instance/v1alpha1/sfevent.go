/*
Copyright 2022 The Service Fabrik Authors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
// Code generated by lister-gen. DO NOT EDIT.

package v1alpha1

import (
	v1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/apis/instance/v1alpha1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/tools/cache"
)

// SfeventLister helps list Sfevents.
// All objects returned here must be treated as read-only.
type SfeventLister interface {
	// List lists all Sfevents in the indexer.
	// Objects returned here must be treated as read-only.
	List(selector labels.Selector) (ret []*v1alpha1.Sfevent, err error)
	// Sfevents returns an object that can list and get Sfevents.
	Sfevents(namespace string) SfeventNamespaceLister
	SfeventListerExpansion
}

// sfeventLister implements the SfeventLister interface.
type sfeventLister struct {
	indexer cache.Indexer
}

// NewSfeventLister returns a new SfeventLister.
func NewSfeventLister(indexer cache.Indexer) SfeventLister {
	return &sfeventLister{indexer: indexer}
}

// List lists all Sfevents in the indexer.
func (s *sfeventLister) List(selector labels.Selector) (ret []*v1alpha1.Sfevent, err error) {
	err = cache.ListAll(s.indexer, selector, func(m interface{}) {
		ret = append(ret, m.(*v1alpha1.Sfevent))
	})
	return ret, err
}

// Sfevents returns an object that can list and get Sfevents.
func (s *sfeventLister) Sfevents(namespace string) SfeventNamespaceLister {
	return sfeventNamespaceLister{indexer: s.indexer, namespace: namespace}
}

// SfeventNamespaceLister helps list and get Sfevents.
// All objects returned here must be treated as read-only.
type SfeventNamespaceLister interface {
	// List lists all Sfevents in the indexer for a given namespace.
	// Objects returned here must be treated as read-only.
	List(selector labels.Selector) (ret []*v1alpha1.Sfevent, err error)
	// Get retrieves the Sfevent from the indexer for a given namespace and name.
	// Objects returned here must be treated as read-only.
	Get(name string) (*v1alpha1.Sfevent, error)
	SfeventNamespaceListerExpansion
}

// sfeventNamespaceLister implements the SfeventNamespaceLister
// interface.
type sfeventNamespaceLister struct {
	indexer   cache.Indexer
	namespace string
}

// List lists all Sfevents in the indexer for a given namespace.
func (s sfeventNamespaceLister) List(selector labels.Selector) (ret []*v1alpha1.Sfevent, err error) {
	err = cache.ListAllByNamespace(s.indexer, s.namespace, selector, func(m interface{}) {
		ret = append(ret, m.(*v1alpha1.Sfevent))
	})
	return ret, err
}

// Get retrieves the Sfevent from the indexer for a given namespace and name.
func (s sfeventNamespaceLister) Get(name string) (*v1alpha1.Sfevent, error) {
	obj, exists, err := s.indexer.GetByKey(s.namespace + "/" + name)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, errors.NewNotFound(v1alpha1.Resource("sfevent"), name)
	}
	return obj.(*v1alpha1.Sfevent), nil
}
