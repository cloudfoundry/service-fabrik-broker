//go:build !ignore_autogenerated

/*
Copyright 2023 The Service Fabrik Authors.

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

// Code generated by controller-gen. DO NOT EDIT.

package v1alpha1

import (
	"k8s.io/apimachinery/pkg/runtime"
)

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *APIVersionKind) DeepCopyInto(out *APIVersionKind) {
	*out = *in
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new APIVersionKind.
func (in *APIVersionKind) DeepCopy() *APIVersionKind {
	if in == nil {
		return nil
	}
	out := new(APIVersionKind)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *BindingResponse) DeepCopyInto(out *BindingResponse) {
	*out = *in
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new BindingResponse.
func (in *BindingResponse) DeepCopy() *BindingResponse {
	if in == nil {
		return nil
	}
	out := new(BindingResponse)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *DashboardClient) DeepCopyInto(out *DashboardClient) {
	*out = *in
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new DashboardClient.
func (in *DashboardClient) DeepCopy() *DashboardClient {
	if in == nil {
		return nil
	}
	out := new(DashboardClient)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *MaintenanceInfo) DeepCopyInto(out *MaintenanceInfo) {
	*out = *in
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new MaintenanceInfo.
func (in *MaintenanceInfo) DeepCopy() *MaintenanceInfo {
	if in == nil {
		return nil
	}
	out := new(MaintenanceInfo)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *MetadataSpec) DeepCopyInto(out *MetadataSpec) {
	*out = *in
	if in.Labels != nil {
		in, out := &in.Labels, &out.Labels
		*out = make(map[string]string, len(*in))
		for key, val := range *in {
			(*out)[key] = val
		}
	}
	if in.Attributes != nil {
		in, out := &in.Attributes, &out.Attributes
		*out = make(map[string]string, len(*in))
		for key, val := range *in {
			(*out)[key] = val
		}
	}
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new MetadataSpec.
func (in *MetadataSpec) DeepCopy() *MetadataSpec {
	if in == nil {
		return nil
	}
	out := new(MetadataSpec)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *SFPlan) DeepCopyInto(out *SFPlan) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ObjectMeta.DeepCopyInto(&out.ObjectMeta)
	in.Spec.DeepCopyInto(&out.Spec)
	out.Status = in.Status
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new SFPlan.
func (in *SFPlan) DeepCopy() *SFPlan {
	if in == nil {
		return nil
	}
	out := new(SFPlan)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyObject is an autogenerated deepcopy function, copying the receiver, creating a new runtime.Object.
func (in *SFPlan) DeepCopyObject() runtime.Object {
	if c := in.DeepCopy(); c != nil {
		return c
	}
	return nil
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *SFPlanList) DeepCopyInto(out *SFPlanList) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ListMeta.DeepCopyInto(&out.ListMeta)
	if in.Items != nil {
		in, out := &in.Items, &out.Items
		*out = make([]SFPlan, len(*in))
		for i := range *in {
			(*in)[i].DeepCopyInto(&(*out)[i])
		}
	}
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new SFPlanList.
func (in *SFPlanList) DeepCopy() *SFPlanList {
	if in == nil {
		return nil
	}
	out := new(SFPlanList)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyObject is an autogenerated deepcopy function, copying the receiver, creating a new runtime.Object.
func (in *SFPlanList) DeepCopyObject() runtime.Object {
	if c := in.DeepCopy(); c != nil {
		return c
	}
	return nil
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *SFPlanSpec) DeepCopyInto(out *SFPlanSpec) {
	*out = *in
	if in.Metadata != nil {
		in, out := &in.Metadata, &out.Metadata
		*out = new(runtime.RawExtension)
		(*in).DeepCopyInto(*out)
	}
	if in.MaintenanceInfo != nil {
		in, out := &in.MaintenanceInfo, &out.MaintenanceInfo
		*out = new(MaintenanceInfo)
		**out = **in
	}
	if in.Schemas != nil {
		in, out := &in.Schemas, &out.Schemas
		*out = new(ServiceSchemas)
		(*in).DeepCopyInto(*out)
	}
	if in.Templates != nil {
		in, out := &in.Templates, &out.Templates
		*out = make([]TemplateSpec, len(*in))
		copy(*out, *in)
	}
	if in.RawContext != nil {
		in, out := &in.RawContext, &out.RawContext
		*out = new(runtime.RawExtension)
		(*in).DeepCopyInto(*out)
	}
	if in.Manager != nil {
		in, out := &in.Manager, &out.Manager
		*out = new(runtime.RawExtension)
		(*in).DeepCopyInto(*out)
	}
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new SFPlanSpec.
func (in *SFPlanSpec) DeepCopy() *SFPlanSpec {
	if in == nil {
		return nil
	}
	out := new(SFPlanSpec)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *SFPlanStatus) DeepCopyInto(out *SFPlanStatus) {
	*out = *in
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new SFPlanStatus.
func (in *SFPlanStatus) DeepCopy() *SFPlanStatus {
	if in == nil {
		return nil
	}
	out := new(SFPlanStatus)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *SFService) DeepCopyInto(out *SFService) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ObjectMeta.DeepCopyInto(&out.ObjectMeta)
	in.Spec.DeepCopyInto(&out.Spec)
	out.Status = in.Status
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new SFService.
func (in *SFService) DeepCopy() *SFService {
	if in == nil {
		return nil
	}
	out := new(SFService)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyObject is an autogenerated deepcopy function, copying the receiver, creating a new runtime.Object.
func (in *SFService) DeepCopyObject() runtime.Object {
	if c := in.DeepCopy(); c != nil {
		return c
	}
	return nil
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *SFServiceBinding) DeepCopyInto(out *SFServiceBinding) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ObjectMeta.DeepCopyInto(&out.ObjectMeta)
	in.Spec.DeepCopyInto(&out.Spec)
	in.Status.DeepCopyInto(&out.Status)
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new SFServiceBinding.
func (in *SFServiceBinding) DeepCopy() *SFServiceBinding {
	if in == nil {
		return nil
	}
	out := new(SFServiceBinding)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyObject is an autogenerated deepcopy function, copying the receiver, creating a new runtime.Object.
func (in *SFServiceBinding) DeepCopyObject() runtime.Object {
	if c := in.DeepCopy(); c != nil {
		return c
	}
	return nil
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *SFServiceBindingList) DeepCopyInto(out *SFServiceBindingList) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ListMeta.DeepCopyInto(&out.ListMeta)
	if in.Items != nil {
		in, out := &in.Items, &out.Items
		*out = make([]SFServiceBinding, len(*in))
		for i := range *in {
			(*in)[i].DeepCopyInto(&(*out)[i])
		}
	}
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new SFServiceBindingList.
func (in *SFServiceBindingList) DeepCopy() *SFServiceBindingList {
	if in == nil {
		return nil
	}
	out := new(SFServiceBindingList)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyObject is an autogenerated deepcopy function, copying the receiver, creating a new runtime.Object.
func (in *SFServiceBindingList) DeepCopyObject() runtime.Object {
	if c := in.DeepCopy(); c != nil {
		return c
	}
	return nil
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *SFServiceBindingSpec) DeepCopyInto(out *SFServiceBindingSpec) {
	*out = *in
	if in.BindResource != nil {
		in, out := &in.BindResource, &out.BindResource
		*out = new(runtime.RawExtension)
		(*in).DeepCopyInto(*out)
	}
	if in.RawContext != nil {
		in, out := &in.RawContext, &out.RawContext
		*out = new(runtime.RawExtension)
		(*in).DeepCopyInto(*out)
	}
	if in.RawParameters != nil {
		in, out := &in.RawParameters, &out.RawParameters
		*out = new(runtime.RawExtension)
		(*in).DeepCopyInto(*out)
	}
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new SFServiceBindingSpec.
func (in *SFServiceBindingSpec) DeepCopy() *SFServiceBindingSpec {
	if in == nil {
		return nil
	}
	out := new(SFServiceBindingSpec)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *SFServiceBindingStatus) DeepCopyInto(out *SFServiceBindingStatus) {
	*out = *in
	out.Response = in.Response
	in.AppliedSpec.DeepCopyInto(&out.AppliedSpec)
	if in.Resources != nil {
		in, out := &in.Resources, &out.Resources
		*out = make([]Source, len(*in))
		copy(*out, *in)
	}
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new SFServiceBindingStatus.
func (in *SFServiceBindingStatus) DeepCopy() *SFServiceBindingStatus {
	if in == nil {
		return nil
	}
	out := new(SFServiceBindingStatus)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *SFServiceInstance) DeepCopyInto(out *SFServiceInstance) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ObjectMeta.DeepCopyInto(&out.ObjectMeta)
	in.Spec.DeepCopyInto(&out.Spec)
	in.Status.DeepCopyInto(&out.Status)
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new SFServiceInstance.
func (in *SFServiceInstance) DeepCopy() *SFServiceInstance {
	if in == nil {
		return nil
	}
	out := new(SFServiceInstance)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyObject is an autogenerated deepcopy function, copying the receiver, creating a new runtime.Object.
func (in *SFServiceInstance) DeepCopyObject() runtime.Object {
	if c := in.DeepCopy(); c != nil {
		return c
	}
	return nil
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *SFServiceInstanceList) DeepCopyInto(out *SFServiceInstanceList) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ListMeta.DeepCopyInto(&out.ListMeta)
	if in.Items != nil {
		in, out := &in.Items, &out.Items
		*out = make([]SFServiceInstance, len(*in))
		for i := range *in {
			(*in)[i].DeepCopyInto(&(*out)[i])
		}
	}
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new SFServiceInstanceList.
func (in *SFServiceInstanceList) DeepCopy() *SFServiceInstanceList {
	if in == nil {
		return nil
	}
	out := new(SFServiceInstanceList)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyObject is an autogenerated deepcopy function, copying the receiver, creating a new runtime.Object.
func (in *SFServiceInstanceList) DeepCopyObject() runtime.Object {
	if c := in.DeepCopy(); c != nil {
		return c
	}
	return nil
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *SFServiceInstanceSpec) DeepCopyInto(out *SFServiceInstanceSpec) {
	*out = *in
	if in.RawContext != nil {
		in, out := &in.RawContext, &out.RawContext
		*out = new(runtime.RawExtension)
		(*in).DeepCopyInto(*out)
	}
	if in.RawParameters != nil {
		in, out := &in.RawParameters, &out.RawParameters
		*out = new(runtime.RawExtension)
		(*in).DeepCopyInto(*out)
	}
	if in.Metadata != nil {
		in, out := &in.Metadata, &out.Metadata
		*out = new(MetadataSpec)
		(*in).DeepCopyInto(*out)
	}
	if in.PreviousValues != nil {
		in, out := &in.PreviousValues, &out.PreviousValues
		*out = new(runtime.RawExtension)
		(*in).DeepCopyInto(*out)
	}
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new SFServiceInstanceSpec.
func (in *SFServiceInstanceSpec) DeepCopy() *SFServiceInstanceSpec {
	if in == nil {
		return nil
	}
	out := new(SFServiceInstanceSpec)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *SFServiceInstanceStatus) DeepCopyInto(out *SFServiceInstanceStatus) {
	*out = *in
	in.AppliedSpec.DeepCopyInto(&out.AppliedSpec)
	if in.Resources != nil {
		in, out := &in.Resources, &out.Resources
		*out = make([]Source, len(*in))
		copy(*out, *in)
	}
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new SFServiceInstanceStatus.
func (in *SFServiceInstanceStatus) DeepCopy() *SFServiceInstanceStatus {
	if in == nil {
		return nil
	}
	out := new(SFServiceInstanceStatus)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *SFServiceList) DeepCopyInto(out *SFServiceList) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ListMeta.DeepCopyInto(&out.ListMeta)
	if in.Items != nil {
		in, out := &in.Items, &out.Items
		*out = make([]SFService, len(*in))
		for i := range *in {
			(*in)[i].DeepCopyInto(&(*out)[i])
		}
	}
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new SFServiceList.
func (in *SFServiceList) DeepCopy() *SFServiceList {
	if in == nil {
		return nil
	}
	out := new(SFServiceList)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyObject is an autogenerated deepcopy function, copying the receiver, creating a new runtime.Object.
func (in *SFServiceList) DeepCopyObject() runtime.Object {
	if c := in.DeepCopy(); c != nil {
		return c
	}
	return nil
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *SFServiceSpec) DeepCopyInto(out *SFServiceSpec) {
	*out = *in
	if in.Tags != nil {
		in, out := &in.Tags, &out.Tags
		*out = make([]string, len(*in))
		copy(*out, *in)
	}
	if in.Requires != nil {
		in, out := &in.Requires, &out.Requires
		*out = make([]string, len(*in))
		copy(*out, *in)
	}
	if in.Metadata != nil {
		in, out := &in.Metadata, &out.Metadata
		*out = new(runtime.RawExtension)
		(*in).DeepCopyInto(*out)
	}
	if in.DashboardClient != nil {
		in, out := &in.DashboardClient, &out.DashboardClient
		*out = new(DashboardClient)
		**out = **in
	}
	if in.RawContext != nil {
		in, out := &in.RawContext, &out.RawContext
		*out = new(runtime.RawExtension)
		(*in).DeepCopyInto(*out)
	}
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new SFServiceSpec.
func (in *SFServiceSpec) DeepCopy() *SFServiceSpec {
	if in == nil {
		return nil
	}
	out := new(SFServiceSpec)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *SFServiceStatus) DeepCopyInto(out *SFServiceStatus) {
	*out = *in
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new SFServiceStatus.
func (in *SFServiceStatus) DeepCopy() *SFServiceStatus {
	if in == nil {
		return nil
	}
	out := new(SFServiceStatus)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *Schema) DeepCopyInto(out *Schema) {
	*out = *in
	if in.Parameters != nil {
		in, out := &in.Parameters, &out.Parameters
		*out = new(runtime.RawExtension)
		(*in).DeepCopyInto(*out)
	}
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new Schema.
func (in *Schema) DeepCopy() *Schema {
	if in == nil {
		return nil
	}
	out := new(Schema)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *ServiceBindingSchema) DeepCopyInto(out *ServiceBindingSchema) {
	*out = *in
	if in.Create != nil {
		in, out := &in.Create, &out.Create
		*out = new(Schema)
		(*in).DeepCopyInto(*out)
	}
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new ServiceBindingSchema.
func (in *ServiceBindingSchema) DeepCopy() *ServiceBindingSchema {
	if in == nil {
		return nil
	}
	out := new(ServiceBindingSchema)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *ServiceInstanceSchema) DeepCopyInto(out *ServiceInstanceSchema) {
	*out = *in
	if in.Create != nil {
		in, out := &in.Create, &out.Create
		*out = new(Schema)
		(*in).DeepCopyInto(*out)
	}
	if in.Update != nil {
		in, out := &in.Update, &out.Update
		*out = new(Schema)
		(*in).DeepCopyInto(*out)
	}
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new ServiceInstanceSchema.
func (in *ServiceInstanceSchema) DeepCopy() *ServiceInstanceSchema {
	if in == nil {
		return nil
	}
	out := new(ServiceInstanceSchema)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *ServiceSchemas) DeepCopyInto(out *ServiceSchemas) {
	*out = *in
	in.Instance.DeepCopyInto(&out.Instance)
	in.Binding.DeepCopyInto(&out.Binding)
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new ServiceSchemas.
func (in *ServiceSchemas) DeepCopy() *ServiceSchemas {
	if in == nil {
		return nil
	}
	out := new(ServiceSchemas)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *Source) DeepCopyInto(out *Source) {
	*out = *in
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new Source.
func (in *Source) DeepCopy() *Source {
	if in == nil {
		return nil
	}
	out := new(Source)
	in.DeepCopyInto(out)
	return out
}

// DeepCopyInto is an autogenerated deepcopy function, copying the receiver, writing into out. in must be non-nil.
func (in *TemplateSpec) DeepCopyInto(out *TemplateSpec) {
	*out = *in
}

// DeepCopy is an autogenerated deepcopy function, copying the receiver, creating a new TemplateSpec.
func (in *TemplateSpec) DeepCopy() *TemplateSpec {
	if in == nil {
		return nil
	}
	out := new(TemplateSpec)
	in.DeepCopyInto(out)
	return out
}
